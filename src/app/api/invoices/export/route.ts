import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { xeroCsv } from '@/lib/xero/invoices';
import { today } from '@/lib/format';

/** Xero's sales-invoice import format — the fallback when the API is not connected. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !['admin', 'accounts'].includes(user.role)) {
    return new NextResponse('Unauthorised', { status: 401 });
  }

  const onlyNew = new URL(request.url).searchParams.get('new') === '1';
  const sb = await supabaseServer();

  let q = sb.from('invoices')
    .select(`number, date, due_date, vat_rate,
             clients(name, email), orders(number),
             invoice_lines(sku, name, qty, unit_price)`)
    .eq('superseded', false)
    .order('number');
  if (onlyNew) q = q.eq('exported', false);

  const [{ data: invoices }, { data: settings }] = await Promise.all([
    q,
    sb.from('settings').select('xero_account_code, tax_type_std, tax_type_zero').eq('id', 1).single(),
  ]);

  const body = xeroCsv((invoices ?? []) as never, settings!);

  // Mark what was exported so the "new" filter stays meaningful.
  if (invoices?.length) {
    await sb.from('invoices').update({ exported: true })
      .in('number', invoices.map((i) => i.number));
  }

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="xero-sales-invoices-${today()}.csv"`,
    },
  });
}
