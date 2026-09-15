import 'server-only';
import React from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { InvoiceDocument, PackingListDocument, type DocData } from './documents';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Gathers everything an invoice or packing list needs to render. */
export async function invoiceDocData(invoiceId: string): Promise<DocData | null> {
  const db = supabaseAdmin();
  const { data: inv } = await db
    .from('invoices')
    .select(`*, orders(number, ship_to),
             clients(name, address, invoicing_address, vat_no),
             locations(name),
             invoice_lines(sku, name, qty, unit_price)`)
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return null;

  const { data: settings } = await db.from('settings').select('company, company_address').eq('id', 1).single();
  const client = inv.clients as {
    name: string; address: string | null;
    invoicing_address: string | null; vat_no: string | null;
  };
  const order = inv.orders as { number: string; ship_to: string | null };
  const lines = (inv.invoice_lines ?? []) as DocData['lines'];

  return {
    invoiceNumber: inv.number,
    orderNumber: order.number,
    type: inv.type,
    date: inv.date,
    dueDate: inv.due_date,
    vatRate: Number(inv.vat_rate),
    lines: [...lines].sort((a, b) => a.sku.localeCompare(b.sku)),
    clientName: client.name,
    clientAddress: client.invoicing_address ?? client.address,
    // Snapshotted when the order was placed, so correcting an address today
    // never changes where a past order says it went. Orders placed before
    // addresses existed fall back to the one address the client had.
    shipTo: order.ship_to ?? client.address,
    clientVatNo: client.vat_no,
    company: settings!.company,
    companyAddress: settings!.company_address,
    paid: inv.paid,
    locationName: (inv.locations as { name: string } | null)?.name ?? null,
  };
}

type PdfElement = React.ReactElement<DocumentProps>;

export const renderInvoicePdf = (d: DocData) =>
  renderToBuffer(React.createElement(InvoiceDocument, { d }) as unknown as PdfElement);

export const renderPackingListPdf = (d: DocData) =>
  renderToBuffer(React.createElement(PackingListDocument, { d }) as unknown as PdfElement);
