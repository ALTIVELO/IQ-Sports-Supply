import { NextResponse } from 'next/server';
import { getSessionUser, isStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { csv } from '@/lib/format';

/** Supplier-format CSV: SKU, quantity, description, reference. No prices. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !isStaff(user.role)) return new NextResponse('Unauthorised', { status: 401 });

  const sb = await supabaseServer();
  const { data: po } = await sb
    .from('purchase_orders')
    .select('number, po_lines(sku, name, qty, so_reference)')
    .eq('id', id).maybeSingle();
  if (!po) return new NextResponse('Not found', { status: 404 });

  const lines = po.po_lines as { sku: string; name: string; qty: number; so_reference: string | null }[];
  const body = csv([
    ['SKU', 'Quantity', 'Description', 'Our reference'],
    ...lines.map((l) => [l.sku, l.qty, l.name, l.so_reference ?? '']),
  ]);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${po.number}.csv"`,
    },
  });
}
