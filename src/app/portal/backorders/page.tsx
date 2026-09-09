import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * One consolidated list across every open order: SKU, product, quantity
 * outstanding, which order it belongs to, and the expected availability date
 * once we know it.
 */
export default async function Backorders() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: lines } = await sb
    .from('order_lines')
    .select(`id, sku, name, bo_qty, unit_price,
             orders!inner(id, number, date, client_id)`)
    .gt('bo_qty', 0)
    .eq('orders.client_id', user.clientId)
    .order('sku');

  // The expected date is the backorder invoice's date, which receiving sets to
  // the availability date the moment stock is booked in.
  const orderIds = [...new Set((lines ?? []).map((l) => (l.orders as unknown as { id: string }).id))];
  const { data: backorderInvoices } = orderIds.length
    ? await sb.from('invoices')
        .select('order_id, date, type, superseded')
        .in('order_id', orderIds).eq('type', 'backorder').eq('superseded', false)
    : { data: [] };

  const expectedByOrder = new Map(
    (backorderInvoices ?? []).map((i) => [i.order_id, i.date as string]),
  );

  const total = (lines ?? []).reduce((a, l) => a + l.bo_qty * Number(l.unit_price), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Items on back order</h1>
        <p className="text-[13px] text-mute mt-1">
          Everything still to come, across all your open orders. We order these from our
          supplier as soon as your order is placed.
        </p>
      </div>

      {!lines?.length ? (
        <Card><Empty>Nothing on back order — everything you have ordered is with us.</Empty></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Product</th>
                  <th className="text-right">Outstanding</th>
                  <th>Order</th><th>Expected</th>
                  <th className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const order = l.orders as unknown as { id: string; number: string; date: string };
                  const expected = expectedByOrder.get(order.id);
                  return (
                    <tr key={l.id}>
                      <td className="num font-semibold">{l.sku}</td>
                      <td>{l.name}</td>
                      <td className="num text-right font-semibold">{l.bo_qty}</td>
                      <td className="num">{order.number}</td>
                      <td>
                        {expected
                          ? <span className="num">{fmtDate(expected)}</span>
                          : <Tag tone="line">on order</Tag>}
                      </td>
                      <td className="num text-right">
                        <Money value={l.bo_qty * Number(l.unit_price)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="text-right font-semibold border-t border-line">
                    Total outstanding, net
                  </td>
                  <td className="num text-right font-semibold border-t border-line">
                    <Money value={total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
