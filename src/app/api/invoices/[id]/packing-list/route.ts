import { NextResponse } from 'next/server';
import { getSessionUser, isStaff } from '@/lib/auth';
import { invoiceDocData, renderPackingListPdf } from '@/lib/pdf/render';

export const runtime = 'nodejs';

/** Packing list PDF with tick boxes. Staff only — it is a warehouse document. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) return new NextResponse('Unauthorised', { status: 401 });

  const doc = await invoiceDocData(id);
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderPackingListPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="packing-${doc.invoiceNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
