import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import {
  orderConfirmation, supplierOrder, supplierSheet, shippedNotice, deliveredNotice,
  welcomeEmail, rejectionEmail, dropshipNotice, returnRaised, returnDecision,
  returnSettled,
} from '@/lib/email/templates';
import {
  SHEET_RECIPIENT, buildSupplierSheet, sheetFilename, supplierSheetData,
} from '@/lib/xlsx/supplier-sheet';
import { RETURN_REASONS } from '@/lib/types';
import { invoiceDocData, renderInvoicePdf } from '@/lib/pdf/render';
import { appUrl } from '@/lib/app-url';

/**
 * Order confirmation with the invoice PDF attached, to the client, CC'd to the
 * addresses held in Settings (Rohail and James).
 */
export async function notifyOrderPlaced(orderId: string) {
  const db = supabaseAdmin();

  const { data: order } = await db
    .from('orders')
    .select(`number, date, agency_terms, brands!orders_agent_brand_id_fkey(name), clients(name, email),
             order_lines(sku, name, qty, unit_price, bo_qty)`)
    .eq('id', orderId)
    .single();
  if (!order) return;

  const { data: invoice } = await db
    .from('invoices')
    .select('id, number, date, due_date, vat_rate, currency')
    .eq('order_id', orderId).eq('type', 'full').eq('superseded', false)
    .maybeSingle();
  if (!invoice) return;

  const { data: settings } = await db
    .from('settings').select('company, confirmation_cc').eq('id', 1).single();

  const client = order.clients as unknown as { name: string; email: string | null };
  const lines = order.order_lines as {
    sku: string; name: string; qty: number; unit_price: number; bo_qty: number;
  }[];

  const msg = orderConfirmation({
    company: settings!.company,
    clientName: client.name,
    orderNumber: order.number,
    invoiceNumber: invoice.number,
    date: invoice.date,
    dueDate: invoice.due_date,
    vatRate: Number(invoice.vat_rate),
    currency: invoice.currency,
    lines,
    backordered: lines.filter((l) => l.bo_qty > 0).map((l) => ({ sku: l.sku, name: l.name, qty: l.bo_qty })),
    portalUrl: `${appUrl()}/portal/orders`,
    // Where we introduced this order rather than sold it, the confirmation
    // says so and stops describing itself as an invoice we will collect on.
    agencyTerms: (order as { agency_terms?: string | null }).agency_terms ?? null,
    agentBrand: (order.brands as unknown as { name: string } | null)?.name ?? null,
  });

  // The invoice PDF travels with the confirmation.
  let attachments;
  try {
    const doc = await invoiceDocData(invoice.id);
    if (doc) {
      const pdf = await renderInvoicePdf(doc);
      attachments = [{ filename: `${invoice.number}.pdf`, content: pdf.toString('base64') }];
    }
  } catch {
    // Still send the confirmation; the PDF is downloadable in-app either way.
  }

  await sendEmail({
    kind: 'order_confirmation',
    to: client.email ? [client.email] : [],
    cc: settings!.confirmation_cc ?? [],
    subject: msg.subject,
    body: msg.body,
    attachments,
    orderId,
    invoiceId: invoice.id,
  });
}

/**
 * Supplier order: SKU, name and quantity only, grouped by the client order
 * reference the supplier is asked to quote back. No prices, no client identity.
 */
export async function notifySupplierOrder(poId: string) {
  const db = supabaseAdmin();

  const { data: po } = await db
    .from('purchase_orders')
    .select('number, date, po_lines(sku, name, qty, so_reference)')
    .eq('id', poId)
    .single();
  if (!po) return;

  const { data: settings } = await db
    .from('settings').select('company, supplier_recipient').eq('id', 1).single();

  const lines = po.po_lines as { sku: string; name: string; qty: number; so_reference: string | null }[];

  // Lines stay grouped and referenced per SO even when a PO bundles several.
  const grouped = new Map<string, { sku: string; name: string; qty: number }[]>();
  for (const l of lines) {
    const key = l.so_reference ?? '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ sku: l.sku, name: l.name, qty: l.qty });
  }

  const msg = supplierOrder({
    company: settings!.company,
    poNumber: po.number,
    date: po.date,
    groups: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ref, ls]) => ({ soReference: ref || null, lines: ls })),
  });

  await sendEmail({
    kind: 'supplier_order',
    to: settings!.supplier_recipient ? [settings!.supplier_recipient] : [],
    subject: msg.subject,
    body: msg.body,
    poId,
  });
}

/**
 * The supplier order as Madison's own form, to James, for him to forward.
 *
 * A second message about the same purchase order as notifySupplierOrder, not a
 * replacement for it: that one is a plain list he can read on a phone, this
 * one is the sheet Madison want to receive. Both go to James; neither goes to
 * Madison.
 *
 * Sent once per purchase order. The email log is what remembers that, so a
 * retried action or a second route to the same PO does not send it twice —
 * `force` is for the resend button, where sending it again is the request.
 */
export async function notifySupplierSheet(
  po: string | string[], opts: { force?: boolean } = {},
) {
  const db = supabaseAdmin();
  const poIds = (Array.isArray(po) ? po : [po]).filter(Boolean);
  if (poIds.length === 0) return;

  const { data: pos } = await db
    .from('purchase_orders')
    .select('id, number, date, receive_location_id, po_lines(sku, name, qty, received_qty, so_reference)')
    .in('id', poIds)
    .order('number');
  if (!pos?.length) return;

  /*
   * Logged against the first of them, because an email belongs to one row.
   * It is also the one the guard reads, which is why a deliberate send — the
   * button, rather than an order being placed — passes `force`.
   */
  const logAgainst = pos[0].id;

  if (!opts.force) {
    const { data: already } = await db
      .from('email_log').select('id')
      .eq('po_id', logAgainst).eq('kind', 'supplier_sheet')
      .in('status', ['sent', 'suppressed']).limit(1);
    if (already?.length) return;
  }

  /*
   * One site, because one sheet is one delivery. Where several purchase
   * orders receive into different places the first one's address goes on it
   * and the caller is the one that refused the mix — but it cannot refuse a
   * purchase order raised before the rule existed, so this does not assume.
   */
  const [{ data: location }, { data: settings }] = await Promise.all([
    db.from('locations').select('name, address')
      .eq('id', pos[0].receive_location_id).single(),
    db.from('settings').select('company').eq('id', 1).single(),
  ]);

  type Row = {
    sku: string; name: string; qty: number; received_qty: number;
    so_reference: string | null;
  };

  /*
   * What is still to come, not what was ordered. A purchase order half
   * received would otherwise ask the supplier a second time for the half
   * that is already on the shelf.
   */
  const lines = pos
    .flatMap((p) => (p.po_lines as Row[]))
    .map((l) => ({ ...l, qty: l.qty - (l.received_qty ?? 0) }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) return;

  /*
   * Everything the supplier may see, and nothing else, is decided in one
   * place: supplierSheetData() takes what we know and returns what goes on the
   * form. The rows handed to it carry no price — po_lines has no price column
   * — but the guarantee does not rest on that staying true.
   */
  const data = supplierSheetData({
    pos: pos.map((p) => ({ number: p.number })),
    // The newest of them: the sheet is written today, whenever the earliest
    // of the orders on it was raised.
    date: pos.map((p) => p.date).sort().slice(-1)[0],
    lines,
    location: location ?? null,
  });

  const file = await buildSupplierSheet(data);
  const filename = sheetFilename(pos.map((p) => p.number));

  const msg = supplierSheet({
    company: settings!.company,
    reference: data.reference,
    filename,
    date: data.date,
    site: data.site,
    clientRefs: data.clientRefs,
    lineCount: data.lines.length,
    totalUnits: data.lines.reduce((n, l) => n + l.qty, 0),
  });

  await sendEmail({
    kind: 'supplier_sheet',
    // Never settings.supplier_recipient. See SHEET_RECIPIENT.
    to: [SHEET_RECIPIENT],
    subject: msg.subject,
    body: msg.body,
    attachments: [{ filename, content: Buffer.from(file).toString('base64') }],
    poId: logAgainst,
  });
}

export async function notifySupplierSheetForOrder(orderId: string) {
  const { data } = await supabaseAdmin()
    .from('order_events').select('meta')
    .eq('order_id', orderId).eq('type', 'supplier_ordered')
    .order('created_at', { ascending: false }).limit(1);

  const poId = (data?.[0]?.meta as { po_id?: string } | null)?.po_id;
  if (poId) await notifySupplierSheet(poId);
}

/**
 * Shipping notification, with every parcel on it. CC'd like the confirmation.
 *
 * `updated` is for a second notice about an order already announced — a
 * corrected number, or a box added after the first went out. It changes what
 * the email says rather than what it contains, because a customer who gets
 * "your order has shipped" twice about one order reasonably wonders whether
 * there are two orders.
 */
export async function notifyShipped(invoiceId: string, opts: { updated?: boolean } = {}) {
  const db = supabaseAdmin();

  const { data: inv } = await db
    .from('invoices')
    .select(`number, carrier, tracking_number, tracking_url, order_id,
             clients(name, email), orders(number), invoice_lines(sku, name, qty),
             shipments(carrier, tracking_number, tracking_url, seq)`)
    .eq('id', invoiceId)
    .single();
  if (!inv) return;

  const { data: settings } = await db
    .from('settings').select('company, confirmation_cc').eq('id', 1).single();
  const client = inv.clients as unknown as { name: string; email: string | null };

  type Row = { carrier: string; tracking_number: string; tracking_url: string | null; seq: number };
  /*
   * The parcels, in the order they were recorded.
   *
   * Falling back to the invoice's own three columns for anything shipped
   * before parcels were rows: those were backfilled, but an email that said
   * nothing at all about tracking would be worse than one quoting the single
   * number we used to hold.
   */
  const rows = [...((inv.shipments ?? []) as Row[])].sort((a, b) => a.seq - b.seq);
  const parcels = rows.length
    ? rows.map((r) => ({
      carrier: r.carrier, tracking: r.tracking_number, trackingUrl: r.tracking_url,
    }))
    : [{
      carrier: inv.carrier ?? '', tracking: inv.tracking_number ?? '',
      trackingUrl: inv.tracking_url ?? null,
    }];

  const msg = shippedNotice({
    company: settings!.company,
    orderNumber: (inv.orders as unknown as { number: string }).number,
    invoiceNumber: inv.number,
    parcels,
    updated: opts.updated,
    lines: inv.invoice_lines as { sku: string; name: string; qty: number }[],
    portalUrl: `${appUrl()}/portal/shipping`,
  });

  await sendEmail({
    kind: 'shipped',
    to: client.email ? [client.email] : [],
    cc: settings!.confirmation_cc ?? [],
    subject: msg.subject,
    body: msg.body,
    orderId: inv.order_id,
    invoiceId,
  });
}

/** Delivery confirmation, once a parcel is confirmed at the client's door. */
export async function notifyDelivered(invoiceId: string) {
  const db = supabaseAdmin();

  const { data: inv } = await db
    .from('invoices')
    .select(`number, order_id, clients(name, email), orders(number), invoice_lines(sku, name, qty)`)
    .eq('id', invoiceId)
    .single();
  if (!inv) return;

  const { data: settings } = await db
    .from('settings').select('company, confirmation_cc').eq('id', 1).single();
  const client = inv.clients as unknown as { name: string; email: string | null };

  const msg = deliveredNotice({
    company: settings!.company,
    orderNumber: (inv.orders as unknown as { number: string }).number,
    invoiceNumber: inv.number,
    lines: inv.invoice_lines as { sku: string; name: string; qty: number }[],
    portalUrl: `${appUrl()}/portal/history`,
  });

  await sendEmail({
    kind: 'delivered',
    to: client.email ? [client.email] : [],
    cc: settings!.confirmation_cc ?? [],
    subject: msg.subject,
    body: msg.body,
    orderId: inv.order_id,
    invoiceId,
  });
}

/** Welcome email on approval, carrying the sign-in link. */
export async function notifyApproved(clientId: string) {
  const db = supabaseAdmin();
  const { data: client } = await db
    .from('clients').select('name, email, tiers(name)').eq('id', clientId).single();
  if (!client) return;

  const { data: settings } = await db.from('settings').select('company').eq('id', 1).single();

  const msg = welcomeEmail({
    company: settings!.company,
    companyName: client.name,
    tierName: (client.tiers as unknown as { name: string })?.name ?? 'trade',
    loginUrl: `${appUrl()}/login`,
  });

  await sendEmail({
    kind: 'welcome',
    to: client.email ? [client.email] : [],
    subject: msg.subject,
    body: msg.body,
  });
}

export async function notifyRejected(email: string, companyName: string, reason: string | null) {
  const db = supabaseAdmin();
  const { data: settings } = await db.from('settings').select('company').eq('id', 1).single();
  const msg = rejectionEmail({ company: settings!.company, companyName, reason });
  await sendEmail({ kind: 'rejection', to: [email], subject: msg.subject, body: msg.body });
}

/**
 * Emails every brand with something to ship on an order.
 *
 * Driven off the notices the database raised when the lines landed, so this
 * cannot disagree with what the brand sees on their dispatch list — and a
 * notice that has already been sent is never sent twice, however many times
 * this is called.
 *
 * One email per brand per order. A brand with three of their products on one
 * order gets one message listing three lines, because that is one box.
 */
export async function notifyDropshipPartners(orderId: string) {
  const db = supabaseAdmin();

  const { data: notices } = await db
    .from('dropship_notices')
    .select('id, brand_id, brands(name)')
    .eq('order_id', orderId)
    .is('notified_at', null);
  if (!notices?.length) return;

  const { data: order } = await db
    .from('orders')
    .select(`number, date, ship_to, dropship, clients(name, address),
             order_lines(sku, name, qty, product_id)`)
    .eq('id', orderId)
    .single();
  if (!order) return;

  const { data: settings } = await db
    .from('settings').select('company').eq('id', 1).single();

  // Which product belongs to which brand, for splitting the lines up.
  const lines = (order.order_lines ?? []) as {
    sku: string; name: string; qty: number; product_id: string | null;
  }[];
  const { data: products } = await db
    .from('products')
    .select('id, brand_id, dropship')
    .in('id', lines.map((l) => l.product_id).filter(Boolean) as string[]);
  const brandOf = new Map((products ?? [])
    .filter((p) => p.dropship)
    .map((p) => [p.id, p.brand_id]));

  const client = order.clients as unknown as { name: string; address: string | null };

  for (const notice of notices as unknown as {
    id: string; brand_id: string; brands: { name: string } | null;
  }[]) {
    const mine = lines.filter((l) => l.product_id && brandOf.get(l.product_id) === notice.brand_id);
    if (!mine.length) continue;

    const { data: people } = await db
      .from('brand_partners')
      .select('email')
      .eq('brand_id', notice.brand_id).eq('active', true);
    const to = (people ?? []).map((p) => p.email).filter(Boolean);
    if (!to.length) continue;

    const msg = dropshipNotice({
      company: settings?.company ?? 'IQ Sports Supply',
      brandName: notice.brands?.name ?? 'your brand',
      orderNumber: order.number,
      date: order.date,
      clientName: client?.name ?? '',
      shipTo: order.ship_to ?? client?.address ?? '',
      dropship: Boolean(order.dropship),
      lines: mine.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty })),
      portalUrl: `${appUrl()}/brand/dispatch`,
    });

    await sendEmail({
      kind: 'dropship_notice', to, subject: msg.subject, body: msg.body, orderId,
    });
    // Recorded only once it has gone, so a failure leaves it to be retried
    // rather than silently marked as told.
    await db.from('dropship_notices')
      .update({ notified_at: new Date().toISOString() }).eq('id', notice.id);
  }
}

/** ── goods coming back ──────────────────────────────────────────────────── */

const REASON_TEXT = Object.fromEntries(RETURN_REASONS.map((r) => [r.key, r.label]));

interface ReturnRow {
  number: string; wanted: string; decision_note: string | null;
  credit_id: string | null; replacement_order_id: string | null;
  clients: { name: string; email: string | null } | null;
  orders: { number: string } | null;
  return_lines: { sku: string; name: string; qty: number; reason: string; note: string | null }[];
}

/** One read, shared by all three notices, so they cannot describe it differently. */
async function readReturn(returnId: string) {
  const db = supabaseAdmin();
  const [{ data: row }, { data: settings }] = await Promise.all([
    db.from('returns')
      .select(`number, wanted, decision_note, credit_id, replacement_order_id,
               clients(name, email), orders(number),
               return_lines(sku, name, qty, reason, note)`)
      .eq('id', returnId).single(),
    db.from('settings')
      .select('company, company_address, returns_recipients').eq('id', 1).single(),
  ]);
  return { db, row: row as unknown as ReturnRow | null, settings };
}

/** To the desk, when a client reports a fault or a wrong item. */
export async function notifyReturnRaised(returnId: string) {
  const { row, settings } = await readReturn(returnId);
  if (!row) return;

  const msg = returnRaised({
    company: settings?.company ?? 'IQ Sports Supply',
    number: row.number,
    clientName: row.clients?.name ?? '',
    orderNumber: row.orders?.number ?? '',
    wanted: row.wanted,
    lines: (row.return_lines ?? []).map((l) => ({
      ...l, reason: REASON_TEXT[l.reason] ?? l.reason,
    })),
    reviewUrl: `${appUrl()}/staff/returns`,
  });

  await sendEmail({
    kind: 'return_raised',
    to: settings?.returns_recipients ?? [],
    subject: msg.subject,
    body: msg.body,
  });
}

/**
 * To the client, when staff approve or decline.
 *
 * An approval carries the address to send to. Our own company address is the
 * right one: goods come back to the people who sent them, not to whichever
 * warehouse the order happened to ship from.
 */
export async function notifyReturnDecided(returnId: string, approved: boolean) {
  const { row, settings } = await readReturn(returnId);
  if (!row?.clients?.email) return;

  const msg = returnDecision({
    company: settings?.company ?? 'IQ Sports Supply',
    number: row.number,
    companyName: row.clients.name,
    orderNumber: row.orders?.number ?? '',
    approved,
    note: row.decision_note,
    returnAddress: `${settings?.company ?? ''}\n${settings?.company_address ?? ''}`,
    portalUrl: `${appUrl()}/portal/returns`,
  });

  await sendEmail({
    kind: 'return_decision',
    to: [row.clients.email],
    cc: settings?.returns_recipients ?? [],
    subject: msg.subject,
    body: msg.body,
  });
}

/** To the client, when it is settled as a credit or a replacement. */
export async function notifyReturnResolved(returnId: string) {
  const { db, row, settings } = await readReturn(returnId);
  if (!row?.clients?.email) return;

  // Whichever document the resolution produced, named rather than described:
  // "credit note IQ-2026-0041" is something a bookkeeper can find.
  const [credit, replacement] = await Promise.all([
    row.credit_id
      ? db.from('invoices').select('number').eq('id', row.credit_id).single()
      : Promise.resolve({ data: null }),
    row.replacement_order_id
      ? db.from('orders').select('number').eq('id', row.replacement_order_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const msg = returnSettled({
    company: settings?.company ?? 'IQ Sports Supply',
    number: row.number,
    companyName: row.clients.name,
    outcome: row.credit_id ? 'refund' : 'exchange',
    creditNumber: credit.data?.number ?? null,
    replacementOrder: replacement.data?.number ?? null,
    portalUrl: `${appUrl()}/portal/returns`,
  });

  await sendEmail({
    kind: 'return_settled',
    to: [row.clients.email],
    cc: settings?.returns_recipients ?? [],
    subject: msg.subject,
    body: msg.body,
  });
}
