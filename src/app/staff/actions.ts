'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth';
import { trackingUrlFor } from '@/lib/format';
import {
  notifyOrderPlaced, notifySupplierOrder, notifyShipped,
} from '@/lib/notifications';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  orderId?: string;
  /** The action succeeded, but a follow-up notification did not go out. */
  warning?: string;
}

/**
 * Runs a notification without letting it fail the action that triggered it.
 *
 * By the time these run the work is already committed — the order is placed,
 * the stock is allocated, the invoice is raised. Throwing here would show the
 * user an error for something that actually succeeded, and they would very
 * reasonably do it again. Report it instead; the message is also in the Outbox.
 */
async function notify(run: () => Promise<void>, what: string): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return `${what} could not be sent (${e instanceof Error ? e.message : String(e)}). ` +
           'Everything else went through — check the Outbox.';
  }
}

const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
});

// ── order placement ─────────────────────────────────────────────────────────

export interface DraftLine { product_id: string; qty: number; unit_price?: number | null }

/**
 * Places an order. Allocation, the full invoice and the supplier order all
 * happen inside place_order() as one transaction; the emails follow, and a
 * failed send never rolls back a placed order.
 */
export async function placeOrder(input: {
  clientId: string;
  locationId: string;
  lines: DraftLine[];
  notes?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const { data: orderId, error } = await sb.rpc('place_order', {
    p_client_id: input.clientId,
    p_location_id: input.locationId,
    p_lines: input.lines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      unit_price: l.unit_price ?? null,
    })),
    p_notes: input.notes ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const warning = await notify(
    () => notifyOrderPlaced(orderId as string), 'The order confirmation');

  revalidatePath('/staff/orders');
  revalidatePath('/staff/supplier');
  revalidatePath('/staff/invoices');
  return { ok: true, orderId: orderId as string, warning };
}

// ── invoices ────────────────────────────────────────────────────────────────

export async function splitInvoice(orderId: string, availableDate: string | null): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('split_invoice', {
    p_order_id: orderId,
    p_available_date: availableDate || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/orders');
  revalidatePath('/staff/invoices');
  return { ok: true, message: 'Invoice split into shipment and back order' };
}

export async function markPaid(invoiceId: string, paidDate: string | null): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('mark_invoice_paid', {
    p_invoice_id: invoiceId,
    p_paid_date: paidDate || null,
    p_source: 'manual',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/invoices');
  revalidatePath('/staff/packing');
  return { ok: true, message: 'Marked paid — released to the packing queue' };
}

export async function markUnpaid(invoiceId: string): Promise<ActionResult> {
  const user = await requireStaff(['admin']);
  const sb = await supabaseServer();
  const { error } = await sb.from('invoices')
    .update({ paid: false, paid_date: null }).eq('id', invoiceId);
  if (error) return { ok: false, error: error.message };
  await sb.from('audit_log').insert({
    actor: user.id, entity: 'invoice', entity_id: invoiceId, action: 'mark_unpaid',
  });
  revalidatePath('/staff/invoices');
  revalidatePath('/staff/packing');
  return { ok: true, message: 'Payment reversed' };
}

// ── packing and shipping ────────────────────────────────────────────────────

export async function markPacked(invoiceId: string): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('mark_invoice_packed', { p_invoice_id: invoiceId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/packing');
  return { ok: true, message: 'Packed' };
}

export async function markShipped(input: {
  invoiceId: string; carrier: string; tracking: string; trackingUrl?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const carrier = input.carrier.trim();
  const tracking = input.tracking.trim();
  if (!carrier || !tracking) {
    return { ok: false, error: 'Carrier and tracking number are both required' };
  }
  const url = input.trackingUrl?.trim() || trackingUrlFor(carrier, tracking);

  const { error } = await sb.rpc('mark_invoice_shipped', {
    p_invoice_id: input.invoiceId,
    p_carrier: carrier,
    p_tracking_number: tracking,
    p_tracking_url: url,
  });
  if (error) return { ok: false, error: error.message };

  const warning = await notify(
    () => notifyShipped(input.invoiceId), 'The shipping notification');

  revalidatePath('/staff/packing');
  revalidatePath('/staff/invoices');
  return {
    ok: true,
    message: warning ? 'Marked shipped' : 'Shipped — the client has been sent the tracking link',
    warning,
  };
}

// ── supplier orders ─────────────────────────────────────────────────────────

export async function createSupplierOrder(input: {
  locationId: string;
  backorderLines: { order_line_id: string; qty: number }[];
  extraLines: { sku: string; name: string; qty: number }[];
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const { data: poId, error } = await sb.rpc('create_supplier_order', {
    p_location_id: input.locationId,
    p_backorder_lines: input.backorderLines,
    p_extra_lines: input.extraLines,
  });
  if (error) return { ok: false, error: error.message };

  const warning = await notify(
    () => notifySupplierOrder(poId as string), 'The supplier order email');

  revalidatePath('/staff/supplier');
  return {
    ok: true,
    message: warning ? 'Supplier order created' : 'Supplier order created and sent',
    warning,
  };
}

export async function receivePo(input: {
  poId: string;
  receipts: { po_line_id: string; qty: number }[];
  availableDate: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('receive_po', {
    p_po_id: input.poId,
    p_receipts: input.receipts.filter((r) => r.qty > 0),
    p_available_date: input.availableDate || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/supplier');
  revalidatePath('/staff/packing');
  revalidatePath('/staff/invoices');
  return { ok: true, message: 'Stock received and booked in against the client orders' };
}

/** Re-sends a supplier order — the copy James forwards. */
export async function resendSupplierOrder(poId: string): Promise<ActionResult> {
  await requireStaff();
  const warning = await notify(() => notifySupplierOrder(poId), 'The supplier order email');
  revalidatePath('/staff/outbox');
  return warning
    ? { ok: false, error: warning }
    : { ok: true, message: 'Supplier order sent' };
}

// ── stock ───────────────────────────────────────────────────────────────────

export async function setStock(input: {
  productId: string; locationId: string; qty: number;
}): Promise<ActionResult> {
  const user = await requireStaff();
  const sb = await supabaseServer();
  const qty = Math.max(0, Math.floor(input.qty));

  const { error } = await sb.from('stock_levels')
    .upsert({ product_id: input.productId, location_id: input.locationId, qty });
  if (error) return { ok: false, error: error.message };

  await sb.from('audit_log').insert({
    actor: user.id, entity: 'stock_level', entity_id: input.productId, action: 'set',
    detail: { location_id: input.locationId, qty },
  });
  revalidatePath('/staff/catalogue');
  return { ok: true };
}

export async function createTransfer(input: {
  fromLocationId: string; toLocationId: string;
  lines: { product_id: string; qty: number }[];
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  if (input.fromLocationId === input.toLocationId) {
    return { ok: false, error: 'Pick two different locations' };
  }
  const lines = input.lines.filter((l) => l.product_id && l.qty > 0);
  if (!lines.length) return { ok: false, error: 'Add at least one line' };

  const { data: number, error: numErr } = await sb.rpc('next_transfer_number');
  if (numErr) return { ok: false, error: numErr.message };

  const { data: transfer, error } = await sb.from('stock_transfers').insert({
    number, from_location_id: input.fromLocationId, to_location_id: input.toLocationId,
  }).select('id').single();
  if (error) return { ok: false, error: error.message };

  const { data: products } = await sb.from('products')
    .select('id, sku, name').in('id', lines.map((l) => l.product_id));

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const { error: lineErr } = await sb.from('stock_transfer_lines').insert(
    lines.map((l) => ({
      transfer_id: transfer.id,
      product_id: l.product_id,
      sku: byId.get(l.product_id)?.sku ?? '',
      name: byId.get(l.product_id)?.name ?? '',
      qty: l.qty,
    })),
  );
  if (lineErr) return { ok: false, error: lineErr.message };

  revalidatePath('/staff/catalogue');
  return { ok: true, message: `Transfer ${number} raised` };
}

export async function receiveTransfer(transferId: string): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('receive_transfer', { p_transfer_id: transferId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/catalogue');
  return { ok: true, message: 'Transfer received' };
}
