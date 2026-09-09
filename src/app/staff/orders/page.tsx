import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading, Card, Empty } from '@/components/ui';
import OrderRow from './OrderRow';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; open?: string }> }) {
  await requireStaff();
  const { q, open } = await searchParams;
  const sb = await supabaseServer();

  let query = sb
    .from('orders')
    .select(`id, number, date, status, notes,
             clients(id, name), locations(name),
             order_lines(id, sku, name, qty, unit_price, alloc_qty, bo_qty, po_qty),
             invoices(id, number, type, date, due_date, paid, packed, shipped, superseded,
                      ready_to_pack, vat_rate),
             order_events(id, order_id, type, created_at, meta)`)
    .order('date', { ascending: false })
    .order('number', { ascending: false })
    .limit(200);

  if (q?.trim()) query = query.ilike('number', `%${q.trim()}%`);

  const { data: orders } = await query;

  const rows = (orders ?? []).filter((o) => {
    if (open === '1') return o.order_lines.some((l) => l.bo_qty > 0) || o.status === 'open';
    return true;
  });

  return (
    <>
      <PageHeading sub="Every order shows what was allocated at its fulfilment site and what is on back order. The full invoice is raised at placement; split it only when a part-shipment becomes necessary.">
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
          {rows.map((o) => <OrderRow key={o.id} order={o as never} />)}
        </div>
      )}
    </>
  );
}
