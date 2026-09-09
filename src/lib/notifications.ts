import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import {
  orderConfirmation, supplierOrder, shippedNotice, welcomeEmail, rejectionEmail,
} from '@/lib/email/templates';
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
    .select(`number, date, clients(name, email),
             order_lines(sku, name, qty, unit_price, bo_qty)`)
    .eq('id', orderId)
    .single();
  if (!order) return;

  const { data: invoice } = await db
    .from('invoices')
    .select('id, number, date, due_date, vat_rate')
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
    lines,
    backordered: lines.filter((l) => l.bo_qty > 0).map((l) => ({ sku: l.sku, name: l.name, qty: l.bo_qty })),
    portalUrl: `${appUrl()}/portal/orders`,
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

/** Shipping notification with the tracking link. */
export async function notifyShipped(invoiceId: string) {
  const db = supabaseAdmin();

  const { data: inv } = await db
    .from('invoices')
    .select(`number, carrier, tracking_number, tracking_url, order_id,
             clients(name, email), orders(number), invoice_lines(sku, name, qty)`)
    .eq('id', invoiceId)
    .single();
  if (!inv) return;

  const { data: settings } = await db.from('settings').select('company').eq('id', 1).single();
  const client = inv.clients as unknown as { name: string; email: string | null };

  const msg = shippedNotice({
    company: settings!.company,
    orderNumber: (inv.orders as unknown as { number: string }).number,
    invoiceNumber: inv.number,
    carrier: inv.carrier ?? '',
    tracking: inv.tracking_number ?? '',
    trackingUrl: inv.tracking_url ?? '',
    lines: inv.invoice_lines as { sku: string; name: string; qty: number }[],
    portalUrl: `${appUrl()}/portal/shipping`,
  });

  await sendEmail({
    kind: 'shipped',
    to: client.email ? [client.email] : [],
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
