import 'server-only';
import React from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { InvoiceDocument, PackingListDocument, type DocData } from './documents';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Why a document could not be built, in words a person can act on. */
export class DocDataError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DocDataError';
  }
}

// ship_to and invoicing_address arrived with the client-account migration.
// Selecting them against a database that has not had it applied yet fails the
// whole query, which used to surface as a blank PDF, so they are asked for
// separately and the document still renders without them.
const BASE_SELECT = `*, orders(number),
             clients(name, address, vat_no),
             locations(name),
             invoice_lines(sku, name, qty, unit_price)`;

const FULL_SELECT = `*, orders(number, ship_to),
             clients(name, address, invoicing_address, vat_no),
             locations(name),
             invoice_lines(sku, name, qty, unit_price)`;

/**
 * Gathers everything an invoice or packing list needs to render.
 *
 * Throws DocDataError rather than returning null for anything that is a fault
 * on our side — a missing service-role key, a query the database refused —
 * so the route can say what is wrong instead of showing an empty tab.
 */
export async function invoiceDocData(invoiceId: string): Promise<DocData | null> {
  let db: ReturnType<typeof supabaseAdmin>;
  try {
    db = supabaseAdmin();
  } catch {
    throw new DocDataError(500,
      'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so invoice PDFs '
      + 'cannot be built. Add it in Vercel → Settings → Environment Variables '
      + 'and redeploy.');
  }

  let { data: inv, error } = await db
    .from('invoices').select(FULL_SELECT).eq('id', invoiceId).maybeSingle();

  if (error) {
    const retry = await db
      .from('invoices').select(BASE_SELECT).eq('id', invoiceId).maybeSingle();
    if (retry.error) {
      throw new DocDataError(500,
        `The invoice could not be read: ${error.message}. `
        + 'A missing column or relationship means supabase/setup.sql has not '
        + 'been fully applied; a network or auth error means '
        + 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is wrong.');
    }
    inv = retry.data;
  }

  if (!inv) return null;

  const { data: settings, error: sErr } = await db
    .from('settings').select('company, company_address').eq('id', 1).maybeSingle();
  if (sErr || !settings) {
    throw new DocDataError(500,
      'The company details in `settings` could not be read, so the invoice has '
      + 'no letterhead. Check row id = 1 exists in the settings table.');
  }

  const client = inv.clients as {
    name: string; address: string | null;
    invoicing_address?: string | null; vat_no: string | null;
  };
  const order = inv.orders as { number: string; ship_to?: string | null };
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
    company: settings.company,
    companyAddress: settings.company_address,
    paid: inv.paid,
    note: inv.note ?? null,
    locationName: (inv.locations as { name: string } | null)?.name ?? null,
  };
}

type PdfElement = React.ReactElement<DocumentProps>;

export const renderInvoicePdf = (d: DocData) =>
  renderToBuffer(React.createElement(InvoiceDocument, { d }) as unknown as PdfElement);

export const renderPackingListPdf = (d: DocData) =>
  renderToBuffer(React.createElement(PackingListDocument, { d }) as unknown as PdfElement);

/**
 * A PDF that fails must say why. An empty body left the browser showing a
 * blank tab, which looks identical whether the service-role key is missing,
 * the migrations are behind, or the invoice simply is not there.
 */
export function pdfFailure(e: unknown, id: string) {
  const known = e instanceof DocDataError;
  const message = known ? e.message : (e as Error)?.message ?? 'Unknown error';
  console.error(`Invoice PDF ${id} failed:`, e);
  return new Response(
    `This document could not be produced.\n\n${message}\n`,
    { status: known ? e.status : 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
