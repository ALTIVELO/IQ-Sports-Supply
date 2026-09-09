import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { xeroFetch } from './client';
import { csv } from '@/lib/format';

/**
 * Pushes an invoice to Xero as an AUTHORISED sales invoice and stores the
 * returned InvoiceID so payment status can be read back.
 */
export async function pushInvoiceToXero(invoiceId: string) {
  const db = supabaseAdmin();

  const { data: inv } = await db
    .from('invoices')
    .select('*, clients(name, email, vat_no), orders(number), invoice_lines(sku, name, qty, unit_price)')
    .eq('id', invoiceId)
    .single();
  if (!inv) throw new Error('Unknown invoice');

  const { data: settings } = await db.from('settings').select('*').eq('id', 1).single();
  const client = inv.clients as { name: string; email: string | null };
  const order = inv.orders as { number: string };
  const lines = inv.invoice_lines as { sku: string; name: string; qty: number; unit_price: number }[];

  const payload = {
    Invoices: [
      {
        Type: 'ACCREC',
        InvoiceNumber: inv.number,
        Reference: order.number,
        Contact: { Name: client.name, EmailAddress: client.email ?? undefined },
        Date: inv.date,
        DueDate: inv.due_date,
        CurrencyCode: 'GBP',
        Status: 'AUTHORISED',
        LineAmountTypes: 'Exclusive',
        LineItems: lines.map((l) => ({
          ItemCode: l.sku,
          Description: l.name,
          Quantity: l.qty,
          UnitAmount: Number(l.unit_price),
          AccountCode: settings!.xero_account_code,
          TaxType: Number(inv.vat_rate) > 0 ? settings!.tax_type_std : settings!.tax_type_zero,
        })),
      },
    ],
  };

  try {
    const res = await xeroFetch('/Invoices', { method: 'POST', body: JSON.stringify(payload) });
    const xeroId = res?.Invoices?.[0]?.InvoiceID as string | undefined;
    await db.from('invoices').update({
      xero_id: xeroId ?? null, xero_status: 'synced', xero_error: null, exported: true,
    }).eq('id', invoiceId);
    return { ok: true as const, xeroId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from('invoices').update({ xero_status: 'error', xero_error: message }).eq('id', invoiceId);
    return { ok: false as const, error: message };
  }
}

/**
 * Reads payment status back for every synced, unpaid invoice. Marking an
 * invoice paid here is what releases it into the packing queue.
 */
export async function syncPaymentStatus(): Promise<{ checked: number; paid: string[] }> {
  const db = supabaseAdmin();
  const { data: pending } = await db
    .from('invoices').select('id, number, xero_id')
    .eq('xero_status', 'synced').eq('paid', false).not('xero_id', 'is', null);

  const paid: string[] = [];
  for (const inv of pending ?? []) {
    try {
      const res = await xeroFetch(`/Invoices/${inv.xero_id}`);
      const x = res?.Invoices?.[0];
      if (!x) continue;
      const settled = x.Status === 'PAID' || Number(x.AmountDue) === 0;
      if (settled) {
        await db.rpc('mark_invoice_paid', {
          p_invoice_id: inv.id,
          p_paid_date: (x.FullyPaidOnDate ?? new Date().toISOString()).slice(0, 10),
          p_source: 'xero',
        });
        paid.push(inv.number);
      }
    } catch {
      // A single unreadable invoice must not stop the rest of the poll.
    }
  }
  return { checked: pending?.length ?? 0, paid };
}

/**
 * Xero's sales invoice import format — the fallback when the API is not
 * connected. Column order is exactly what Xero expects.
 */
export function xeroCsv(
  invoices: {
    number: string; date: string; due_date: string; vat_rate: number;
    clients: { name: string; email: string | null };
    orders: { number: string };
    invoice_lines: { sku: string; name: string; qty: number; unit_price: number }[];
  }[],
  settings: { xero_account_code: string; tax_type_std: string; tax_type_zero: string },
) {
  const rows: unknown[][] = [[
    '*ContactName', 'EmailAddress', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate',
    'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType', 'Currency',
  ]];
  for (const inv of invoices) {
    for (const l of inv.invoice_lines) {
      rows.push([
        inv.clients?.name, inv.clients?.email ?? '', inv.number, inv.orders?.number,
        inv.date, inv.due_date, l.sku, l.name, l.qty, Number(l.unit_price).toFixed(2),
        settings.xero_account_code,
        Number(inv.vat_rate) > 0 ? settings.tax_type_std : settings.tax_type_zero,
        'GBP',
      ]);
    }
  }
  return csv(rows);
}
