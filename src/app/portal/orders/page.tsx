import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import Timeline from '@/components/Timeline';
import type { OrderEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Every order not yet fully delivered, each with its live status timeline. */
export default async function CurrentOrders() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: orders } = await sb
    .from('orders')
    .select(`id, number, date, status,
             order_lines(id, sku, name, qty, unit_price, alloc_qty, bo_qty),
             invoices(id, number, type, paid, packed, shipped, superseded, carrier, tracking_number, tracking_url),
             order_events(id, order_id, type, created_at, meta)`)
    .eq('client_id', user.clientId)
    .order('date', { ascending: false })
    .limit(100);

  // "Not yet fully delivered" = at least one live invoice still unshipped.
  const current = (orders ?? []).filter((o) => {
    const live = o.invoices.filter((i) => !i.superseded);
    return live.length === 0 || live.some((i) => !i.shipped);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Current orders</h1>
        <p className="text-[13px] text-mute mt-1">
          Everything still on its way to you, with live progress.
        </p>
      </div>

      {current.length === 0 ? (
        <Card><Empty>Nothing outstanding — every order has shipped.</Empty></Card>
      ) : (
        current.map((o) => {
          const total = o.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
          const backordered = o.order_lines.reduce((a, l) => a + l.bo_qty, 0);
          const live = o.invoices.filter((i) => !i.superseded);

          return (
            <Card key={o.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="num font-bold text-[15px]">{o.number}</span>
                <span className="text-[12px] text-mute num">{fmtDate(o.date)}</span>
                {backordered > 0 && <Tag tone="line">{backordered} on back order</Tag>}
                <span className="num ml-auto font-semibold text-[14px]">
                  <Money value={total} /> <span className="text-mute font-normal text-[12px]">net</span>
                </span>
              </div>

              <div className="grid md:grid-cols-[1fr_220px] gap-5 mt-4">
                <div className="min-w-0 overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>SKU</th><th>Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">To follow</th>
                        <th className="text-right">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.order_lines.map((l) => (
                        <tr key={l.id}>
                          <td className="num">{l.sku}</td>
                          <td>{l.name}</td>
                          <td className="num text-right">{l.qty}</td>
                          <td className={`num text-right ${l.bo_qty ? 'font-semibold' : 'text-mute'}`}>
                            {l.bo_qty || '—'}
                          </td>
                          <td className="num text-right"><Money value={Number(l.unit_price)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {live.map((i) => (
                      <a
                        key={i.id}
                        href={`/api/invoices/${i.id}/pdf`}
                        target="_blank" rel="noreferrer"
                        className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                      >
                        {i.number} {i.paid ? '· paid' : '· awaiting payment'}
                      </a>
                    ))}
                    {live.filter((i) => i.tracking_url).map((i) => (
                      <a
                        key={`t${i.id}`}
                        href={i.tracking_url!}
                        target="_blank" rel="noreferrer"
                        className="text-[12px] font-semibold border border-transparent bg-cobalt text-white rounded px-[10px] py-[5px]"
                      >
                        Track {i.carrier} {i.tracking_number}
                      </a>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-2.5">
                    Progress
                  </div>
                  <Timeline events={(o.order_events ?? []) as OrderEvent[]} />
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
