import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Every past order, searchable, with lines, quantities and totals. */
export default async function OrderHistory({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireClient();
  const { q } = await searchParams;
  const sb = await supabaseServer();

  const { data: orders } = await sb
    .from('orders')
    .select(`id, number, date, status,
             order_lines(id, sku, name, qty, unit_price, bo_qty),
             invoices(id, number, paid, shipped, superseded)`)
    .eq('client_id', user.clientId)
    .order('date', { ascending: false })
    .limit(300);

  const term = q?.trim().toLowerCase() ?? '';
  const filtered = (orders ?? []).filter((o) => {
    if (!term) return true;
    return (
      o.number.toLowerCase().includes(term) ||
      o.order_lines.some((l) => `${l.sku} ${l.name}`.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Order history</h1>
        <p className="text-[13px] text-mute mt-1">Every order you have placed with us.</p>
      </div>

      <form className="flex gap-2">
        <input
          name="q" defaultValue={q ?? ''}
          placeholder="Search by order number, SKU or product…"
          className="max-w-md"
        />
        <button className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch">
          Search
        </button>
      </form>

      {filtered.length === 0 ? (
        <Card><Empty>{term ? 'Nothing matches that search.' : 'No orders yet.'}</Empty></Card>
      ) : (
        filtered.map((o) => {
          const total = o.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
          const live = o.invoices.filter((i) => !i.superseded);
          const allShipped = live.length > 0 && live.every((i) => i.shipped);

          return (
            <Card key={o.id}>
              <details>
                <summary className="cursor-pointer list-none flex flex-wrap items-center gap-3">
                  <span className="num font-bold">{o.number}</span>
                  <span className="text-[12px] text-mute num">{fmtDate(o.date)}</span>
                  <span className="text-[12px] text-mute">
                    {o.order_lines.length} line{o.order_lines.length === 1 ? '' : 's'}
                  </span>
                  {allShipped ? <Tag tone="green">Delivered</Tag> : <Tag tone="line">In progress</Tag>}
                  <span className="num ml-auto font-semibold"><Money value={total} /></span>
                </summary>

                <div className="overflow-x-auto mt-3">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th><th>Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Unit</th>
                        <th className="text-right">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.order_lines.map((l) => (
                        <tr key={l.id}>
                          <td className="num">{l.sku}</td>
                          <td>{l.name}</td>
                          <td className="num text-right">{l.qty}</td>
                          <td className="num text-right"><Money value={Number(l.unit_price)} /></td>
                          <td className="num text-right">
                            <Money value={l.qty * Number(l.unit_price)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {live.map((i) => (
                    <a
                      key={i.id} href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"
                      className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                    >
                      {i.number} PDF
                    </a>
                  ))}
                </div>
              </details>
            </Card>
          );
        })
      )}
    </div>
  );
}
