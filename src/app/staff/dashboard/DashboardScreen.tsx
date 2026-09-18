'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Money, Notice, Tag } from '@/components/ui';
import { PERIODS, type PeriodKey } from '@/lib/reporting/period';
import { CURRENCY_SYMBOL, currencyOf } from '@/lib/format';
import { SalesChart, OrdersChart, Legend, type Bucket } from './Charts';

export interface Totals {
  orders: number; revenue: number; cost: number; profit: number;
  /** Lines with no recorded cost, which this report does not cover. */
  excludedLines: number;
  excludedRevenue: number;
}
export interface TopClient {
  clientId: string; name: string; orders: number; revenue: number; profit: number;
}

export interface DashboardData {
  period: PeriodKey;
  /** The currency every figure below is in. Nothing here sums across two. */
  currency: string;
  /** The currencies there is anything to report on, so the tabs know to appear. */
  currencies: string[];
  description: string;
  previousLabel: string;
  now: Totals;
  before: Totals;
  buckets: Bucket[];
  clients: TopClient[];
  /**
   * Orders we introduced rather than sold, per brand.
   *
   * Kept out of every figure above and reported on its own, because the goods
   * value on these is the brand's revenue and not ours. Folding it in would
   * overstate the business by the whole price of every bike; leaving it out
   * entirely would make it disappear.
   */
  agency: AgencyLine[];
}

export interface AgencyLine {
  brandId: string; name: string; orders: number;
  goods: number;
  /** Null where the period's orders were placed at more than one rate. */
  rate: number | null;
  commission: number;
}

const margin = (t: Totals) => (t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0);

export default function DashboardScreen({ data }: { data: DashboardData }) {
  const router = useRouter();
  const { now, before, currency } = data;
  const go = (period: PeriodKey, money: string) =>
    router.push(`/staff/dashboard?period=${period}&currency=${money}`);

  return (
    <div className="space-y-5">
      {/* One row of filters, above everything they scope. */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => go(p.key, currency)}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${data.period === p.key
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-line hover:bg-parch'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[12px] text-mute ml-1">{data.description}</span>

        {/* Only where there is a second currency to switch to. One report per
            currency: a total that added euros to pounds would be a rate we
            never transacted at, quoted as fact. */}
        {data.currencies.length > 1 && (
          <div className="flex gap-1 ml-auto">
            {data.currencies.map((code) => (
              <button
                key={code}
                onClick={() => go(data.period, code)}
                className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
                  ${currency === code
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white border-line hover:bg-parch'}`}
              >
                {CURRENCY_SYMBOL[currencyOf(code)]} {code}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={<Money value={now.revenue} currency={currency} />}
              now={now.revenue} before={before.revenue} against={data.previousLabel} />
        <Stat label="Profit" value={<Money value={now.profit} currency={currency} />}
              now={now.profit} before={before.profit} against={data.previousLabel} />
        <Stat label="Margin"
              value={<>{margin(now).toFixed(1)}<span className="text-[16px]">%</span></>}
              now={margin(now)} before={margin(before)} against={data.previousLabel}
              points />
        <Stat label="Orders" value={now.orders.toLocaleString('en-GB')}
              now={now.orders} before={before.orders} against={data.previousLabel} />
      </div>

      {now.excludedLines > 0 && <Excluded totals={now} currency={currency} />}

      <Card>
        <div className="flex flex-wrap items-baseline gap-3 mb-1">
          <h2 className="text-[14px] font-semibold">Revenue, and what was left of it</h2>
          <span className="text-[12px] text-mute ml-auto">Net of VAT, by order date</span>
        </div>
        <div className="mb-3"><Legend /></div>
        <SalesChart data={data.buckets} currency={currency} />
      </Card>

      <Card>
        <h2 className="text-[14px] font-semibold mb-3">Orders</h2>
        <OrdersChart data={data.buckets} />
      </Card>

      {data.agency.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline gap-3 mb-1">
            <h2 className="text-[14px] font-semibold">Introduced, not sold</h2>
            <span className="text-[12px] text-mute ml-auto">
              Not counted in anything above
            </span>
          </div>
          <p className="text-[12px] text-mute mb-3 max-w-2xl leading-relaxed">
            These orders went to the brand, who invoiced the customer and shipped them.
            The goods are their revenue. Ours is the commission.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Goods they invoiced</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Our commission</th>
                </tr>
              </thead>
              <tbody>
                {data.agency.map((a) => (
                  <tr key={a.brandId}>
                    <td className="font-semibold">{a.name}</td>
                    <td className="num text-right">{a.orders}</td>
                    <td className="num text-right text-mute">
                      <Money value={a.goods} currency={currency} />
                    </td>
                    <td className="num text-right text-mute">
                      {a.rate === null ? 'several' : `${a.rate}%`}
                    </td>
                    <td className="num text-right font-semibold">
                      {a.commission === 0
                        ? <span className="text-danger">no rate set</span>
                        : <Money value={a.commission} currency={currency} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/*
        * Both tracks get a floor. A grid column sized `auto` or `1fr` takes
        * the min-content width of its widest child, and the widest child here
        * is a table: at phone width the two cards grew past the viewport and
        * took the whole page with them, scroll container and all.
        */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 items-start">
        <Card>
          <h2 className="text-[14px] font-semibold mb-3">Every period in figures</h2>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">To supplier</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b) => (
                  <tr key={b.bucket} className={b.orders === 0 ? 'text-mute' : ''}>
                    <td className="num whitespace-nowrap">{b.label}</td>
                    <td className="num text-right">{b.orders || '—'}</td>
                    <td className="num text-right">
                      <Money value={b.revenue} currency={currency} />
                    </td>
                    <td className="num text-right text-mute">
                      <Money value={b.cost} currency={currency} />
                    </td>
                    <td className="num text-right font-semibold">
                      <Money value={b.profit} currency={currency} />
                    </td>
                    <td className="num text-right">
                      {b.revenue > 0 ? `${((b.profit / b.revenue) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="text-[14px] font-semibold mb-3">Best clients</h2>
          {data.clients.length === 0 ? (
            <p className="text-[13px] text-mute">Nobody ordered in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.clientId}>
                      <td>{c.name}</td>
                      <td className="num text-right">{c.orders}</td>
                      <td className="num text-right font-semibold">
                        <Money value={c.profit} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * What the figures above do not cover.
 *
 * The report is deliberately smaller than the order book — a line we cannot
 * cost is left out rather than counted as free — and a number that is smaller
 * than someone expects, for a reason nobody stated, is how a dashboard loses
 * its readers. So the gap is named, in lines and in money, every time there
 * is one.
 */
function Excluded({ totals, currency }: { totals: Totals; currency: string }) {
  const one = totals.excludedLines === 1;
  const share = totals.revenue + totals.excludedRevenue > 0
    ? (totals.excludedRevenue / (totals.revenue + totals.excludedRevenue)) * 100
    : 0;

  return (
    <Notice tone={share >= 20 ? 'error' : 'info'}>
      Not counted above: {totals.excludedLines} order line{one ? '' : 's'} worth{' '}
      <strong className="num">
        <Money value={totals.excludedRevenue} currency={currency} />
      </strong>
      {share >= 1 && <> — {share.toFixed(0)}% of what was ordered</>}. We have no cost
      for {one ? 'it' : 'them'}, so {one ? 'it is' : 'they are'} left out of revenue and
      profit rather than counted as costing nothing.{' '}
      <Link href="/staff/import" className="text-ink font-semibold underline">
        Import a cost column
      </Link>{' '}
      and past orders are costed with it, back to the day each was placed.
    </Notice>
  );
}

/**
 * One headline figure and its change.
 *
 * The change is omitted rather than invented where the period before it was
 * zero: a rise from nothing is not a percentage, and "+100%" would be a
 * number someone repeats in a meeting.
 */
function Stat({ label, value, now, before, against, points = false }: {
  label: string; value: React.ReactNode;
  now: number; before: number; against: string;
  /** A margin moves in percentage points, not by a percentage of itself. */
  points?: boolean;
}) {
  const change = points ? now - before : before === 0 ? null : ((now - before) / before) * 100;
  const up = change !== null && change > 0;
  const flat = change !== null && Math.abs(change) < 0.05;

  return (
    <Card>
      <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">{label}</div>
      <div className="text-[26px] font-semibold tracking-[-0.02em] mt-1.5">{value}</div>
      <div className="text-[12px] text-mute mt-1.5 flex items-center gap-1.5">
        {change === null ? (
          <span>nothing in {against} to compare</span>
        ) : (
          <>
            <Tag tone={flat ? 'line' : up ? 'green' : 'red'}>
              {flat ? 'level' : `${up ? '+' : '−'}${Math.abs(change).toFixed(points ? 1 : 0)}`
                + (points ? ' pts' : '%')}
            </Tag>
            <span>vs {against}</span>
          </>
        )}
      </div>
    </Card>
  );
}
