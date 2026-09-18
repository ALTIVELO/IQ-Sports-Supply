import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/chunk';
import { claimedByLine, lastDispatch, windowClosed } from '@/lib/returns/returnable';
import { Card, Empty, Money, Tag, VoidTag, voidedRow, voidedText } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import ReportProblem from '../returns/ReportProblem';

export const dynamic = 'force-dynamic';

/** Every past order, searchable, with lines, quantities and totals. */
export default async function OrderHistory({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireClient();
  const { q } = await searchParams;
  const sb = await supabaseServer();

  const [{ data: orders }, { data: settings }] = await Promise.all([
    sb.from('orders')
      .select(`id, number, date, status, currency,
               order_lines(id, sku, name, qty, unit_price, bo_qty),
               invoices(id, number, paid, shipped, shipped_at, delivered, superseded)`)
      .eq('client_id', user.clientId)
      .order('date', { ascending: false })
      .limit(300),
    sb.from('settings').select('returns_days').eq('id', 1).single(),
  ]);

  const days = settings?.returns_days ?? 30;

  /*
   * How much of each line has already been spoken for by a return.
   *
   * returnable_qty() in the database is the authority and is what
   * request_return() checks against; this is the same arithmetic done once
   * for the whole page so the form can show a number and cap an input,
   * rather than one round trip per line. Row-paged, because a client with
   * years of history can have more return lines than a single response
   * carries — and a truncated read here would offer back stock that is
   * already on its way.
   */
  const claimed = await fetchAll<{ order_line_id: string; qty: number }>((from, to) =>
    sb.from('return_lines')
      .select('order_line_id, qty, returns!inner(status)')
      .not('returns.status', 'in', '(declined,cancelled)')
      .order('order_line_id')
      .range(from, to),
  );
  const used = claimedByLine(claimed);

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
          const allDelivered = live.length > 0 && live.every((i) => i.delivered);
          const allShipped = live.length > 0 && live.every((i) => i.shipped);
          const cancelled = o.status === 'cancelled';

          // The returns window runs from the last dispatch on the order, the
          // same date request_return() measures from.
          const shippedOn = lastDispatch(o.invoices);
          const closed = windowClosed(shippedOn, days);

          return (
            <Card key={o.id} className={cancelled ? voidedRow : ''}>
              <details>
                <summary className="cursor-pointer list-none flex flex-wrap items-center gap-3">
                  <span className={`num font-bold ${cancelled ? voidedText : ''}`}>{o.number}</span>
                  <span className="text-[12px] text-mute num">{fmtDate(o.date)}</span>
                  <span className="text-[12px] text-mute">
                    {o.order_lines.length} line{o.order_lines.length === 1 ? '' : 's'}
                  </span>
                  {/* A cancelled order is neither delivered nor in progress. */}
                  {cancelled
                    ? <VoidTag>cancelled</VoidTag>
                    : allDelivered
                      ? <Tag tone="green">Delivered</Tag>
                      : allShipped
                        ? <Tag tone="line">Shipped</Tag>
                        : <Tag tone="line">In progress</Tag>}
                  <span className={`num ml-auto font-semibold ${cancelled ? 'line-through' : ''}`}>
                    <Money value={total} currency={o.currency} />
                  </span>
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
                          <td className="num text-right">
                            <Money value={Number(l.unit_price)} currency={o.currency} />
                          </td>
                          <td className="num text-right">
                            <Money value={l.qty * Number(l.unit_price)} currency={o.currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {live.map((i) => (
                    <a
                      key={i.id} href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"
                      className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                    >
                      {i.number} PDF
                    </a>
                  ))}
                  {!cancelled && (
                    <ReportProblem
                      orderId={o.id}
                      dispatched={shippedOn !== null}
                      windowClosed={closed}
                      days={days}
                      lines={o.order_lines.map((l) => ({
                        id: l.id, sku: l.sku, name: l.name,
                        left: Math.max(0, l.qty - (used.get(l.id) ?? 0)),
                      }))}
                    />
                  )}
                </div>
              </details>
            </Card>
          );
        })
      )}
    </div>
  );
}
