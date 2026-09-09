import { NextResponse } from 'next/server';
import { getSessionUser, isStaff } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { invoiceDocData, renderInvoicePdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

/** Invoice PDF. Staff see any; a client sees only their own. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorised', { status: 401 });

  if (!isStaff(user.role)) {
    const { data } = await supabaseAdmin()
      .from('invoices').select('client_id').eq('id', id).maybeSingle();
    if (!data || data.client_id !== user.clientId) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  const doc = await invoiceDocData(id);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderInvoicePdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
