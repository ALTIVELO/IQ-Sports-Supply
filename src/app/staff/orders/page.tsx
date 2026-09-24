import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/chunk';
import Link from 'next/link';
import { PageHeading, Card, Empty, Money, Tag } from '@/components/ui';
import { summarise, type HistoryOrder } from '@/lib/orders/history';
import OrderRow from './OrderRow';

export const dynamic = 'force-dynamic';

/** "4 Mar 2026" — a date somebody reads aloud, not one they parse. */
const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric' });

export default async function OrdersPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; open?: string; client?: string }> }) {
  const user = await requireStaff();
  const { q, open, client } = await searchParams;
  const sb = await supabaseServer();

  const selects = `id, number, date, status, notes, currency, agency_terms,
       dropship, ship_to, dropship_terms, dropship_accepted_at,
       brands!orders_agent_brand_id_fkey(name),
       clients(id, name), locations(name),
       cancelled_reason,
       order_lines(id, product_id, sku, name, qty, unit_price, alloc_qty, bo_qty, po_qty),
       invoices(id, number, type, date, due_date, paid, packed, shipped, superseded,
                ready_to_pack, vat_rate),
       order_events(id, order_id, type, created_at, meta)`;

  /*
   * One client's whole history, or the recent two hundred of everybody's.
   *
   * The unfiltered list is a working screen — what is open, what shipped this
   * week — and two hundred is more than anybody scrolls. Asked about one
   * client it is a different question: "everything they have ever bought"
   * truncated at two hundred is an answer that looks complete and is not, so
   * that one is paged through in full.
   */
  const matching = () => {
    let query = sb.from('orders').select(selects)
      .order('date', { ascending: false })
      .order('number', { ascending: false });
    // Both filters, whichever way the screen was reached. Picking a client and
    // then searching a number has to narrow rather than start again.
    if (client) query = query.eq('client_id', client);
    if (q?.trim()) query = query.ilike('number', `%${q.trim()}%`);
    return query;
  };

  const [orders, clients, products, { data: lineCosts }, { data: settings }] =
    await Promise.all([
    client
      ? fetchAll((from, to) => matching().range(from, to))
      : matching().limit(200).then(({ data }) => data ?? []),
    // For the picker, and for naming whoever is being looked at.
    sb.from('clients').select('id, name').order('name').then(({ data }) => data ?? []),
    // For adding a line while editing. The catalogue, not this order's lines.
    fetchAll((from, to) => sb.from('products').select('id, sku, name')
      .eq('active', true).order('sku').range(from, to)),
    // What each line cost us, as recorded when it was placed. A separate table
    // because a client reads their own order lines and may never read this.
    sb.from('order_line_costs').select('order_line_id, unit_cost'),
    sb.from('settings').select('company').eq('id', 1).single(),
  ]);

  const costOf: Record<string, number> = {};
  for (const c of lineCosts ?? []) costOf[c.order_line_id] = Number(c.unit_cost);

  const rows = (orders ?? []).filter((o) => {
    if (open === '1') return o.order_lines.some((l) => l.bo_qty > 0) || o.status === 'open';
    return true;
  });

  const looking = client ? clients.find((c) => c.id === client) ?? null : null;
  /*
   * Summarised over everything they have bought.
   *
   * Not over what is on screen: with "open only" ticked or a number typed,
   * the rows are a slice, and a lifetime total that moves when you tick a box
   * is a lifetime total of nothing in particular. So when either filter is on
   * it is counted from its own query rather than from the rows.
   */
  const narrowed = Boolean(q?.trim());
  const forSummary = narrowed && client
    ? await fetchAll<HistoryOrder>((from, to) => sb.from('orders')
        .select('date, status, currency, order_lines(qty, unit_price)')
        .eq('client_id', client).range(from, to))
    : (orders ?? []) as unknown as HistoryOrder[];
  const history = client ? summarise(forSummary) : null;

  return (
    <>
      <PageHeading sub="Every order shows what was allocated at its fulfilment site and what is on back order, alongside what it cost us and what it earned. The full invoice is raised at placement; split it only when a part-shipment becomes necessary.">
        Orders
      </PageHeading>

      {looking && history && (
        <Card accent className="mb-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold">{looking.name}</h2>
            <span className="text-[12px] text-mute">
              {history.placed === 0
                ? 'has never ordered'
                : <>
                    {history.placed} order{history.placed === 1 ? '' : 's'}
                    {history.first && history.last && (
                      history.first === history.last
                        ? <> · {when(history.last)}</>
                        : <> · {when(history.first)} to {when(history.last)}</>
                    )}
                  </>}
            </span>
            {history.cancelled > 0 && (
              /* Counted here and left out of the money below, rather than
                 dropped: a lifetime total that includes orders that never
                 shipped is wrong, and a count that quietly differs from the
                 rows underneath is worse. */
              <Tag tone="line">{history.cancelled} cancelled</Tag>
            )}
            <span className="ml-auto flex flex-wrap items-baseline gap-3">
              {history.totals.map((tot) => (
                <span key={tot.currency} className="num text-[15px] font-semibold">
                  <Money value={tot.net} currency={tot.currency} />
                </span>
              ))}
              {history.placed > 0 && (
                <span className="text-[11px] text-mute">net, lifetime</span>
              )}
            </span>
            <Link href="/staff/orders"
                  className="text-[12px] text-flame-text font-semibold whitespace-nowrap">
              All orders
            </Link>
          </div>
        </Card>
      )}

      <form className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          name="q" defaultValue={q ?? ''} placeholder="Search order number…"
          className="max-w-[240px]"
        />
        {/* Reached from the Clients screen by clicking a name, and offered
            here too, because the question is asked from both directions. */}
        <select name="client" defaultValue={client ?? ''} className="max-w-[220px] text-[12px]">
          <option value="">Every client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
          <input type="checkbox" name="open" value="1" defaultChecked={open === '1'} />
          Open only
        </label>
        <button className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <Empty>
            {looking
              ? `${looking.name} has no orders${open === '1' ? ' open' : ''} yet.`
              : 'No orders yet. Take one from the Order desk.'}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((o) => (
            <OrderRow
              key={o.id}
              order={o as never}
              products={products as never}
              costOf={costOf}
              company={settings?.company ?? 'IQ Sports Supply'}
              canAmend={user.role === 'admin' || user.role === 'accounts'}
              canDelete={user.role === 'admin'}
            />
          ))}
        </div>
      )}
    </>
  );
}
