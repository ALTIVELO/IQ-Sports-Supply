import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading, Card, Empty } from '@/components/ui';
import OrderRow from './OrderRow';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; open?: string }> }) {
  const user = await requireStaff();
  const { q, open } = await searchParams;
  const sb = await supabaseServer();

  let query = sb
    .from('orders')
    .select(`id, number, date, status, notes, currency,
             clients(id, name), locations(name),
             cancelled_reason,
             order_lines(id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty, po_qty),
             invoices(id, number, type, date, due_date, paid, packed, shipped, superseded,
                      ready_to_pack, vat_rate),
             order_events(id, order_id, type, created_at, meta)`)
    .order('date', { ascending: false })
    .order('number', { ascending: false })
    .limit(200);

  if (q?.trim()) query = query.ilike('number', `%${q.trim()}%`);

  const [{ data: orders }, { data: products }, { data: lineCosts }] = await Promise.all([
    query,
    // For adding a line while editing. The catalogue, not this order's lines.
    sb.from('products').select('id, sku, name').eq('active', true).order('sku').limit(2000),
    // What each line cost us, as recorded when it was placed. A separate table
    // because a client reads their own order lines and may never read this.
    sb.from('order_line_costs').select('order_line_id, unit_cost'),
  ]);

  const costOf: Record<string, number> = {};
  for (const c of lineCosts ?? []) costOf[c.order_line_id] = Number(c.unit_cost);

  const rows = (orders ?? []).filter((o) => {
    if (open === '1') return o.order_lines.some((l) => l.bo_qty > 0) || o.status === 'open';
    return true;
  });

  return (
    <>
      <PageHeading sub="Every order shows what was allocated at its fulfilment site and what is on back order, alongside what it cost us and what it earned. The full invoice is raised at placement; split it only when a part-shipment becomes necessary.">
        Orders
      </PageHeading>

      <form className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          name="q" defaultValue={q ?? ''} placeholder="Search order number…"
          className="max-w-[240px]"
        />
        <label className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
          <input type="checkbox" name="open" value="1" defaultChecked={open === '1'} />
          Open only
        </label>
        <button className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <Card><Empty>No orders yet. Take one from the Order desk.</Empty></Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((o) => (
            <OrderRow
              key={o.id}
              order={o as never}
              products={(products ?? []) as never}
              costOf={costOf}
              canAmend={user.role === 'admin' || user.role === 'accounts'}
              canDelete={user.role === 'admin'}
            />
          ))}
        </div>
      )}
    </>
  );
}
