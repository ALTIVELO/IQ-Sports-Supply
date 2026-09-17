'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Money, Notice, Tag } from '@/components/ui';
import { PERIODS, type PeriodKey } from '@/lib/reporting/period';
import { SalesChart, OrdersChart, Legend, type Bucket } from './Charts';

export interface Totals {
  orders: number; revenue: number; cost: number; profit: number; uncostedLines: number;
}
export interface TopClient {
  clientId: string; name: string; orders: number; revenue: number; profit: number;
}

export interface DashboardData {
  period: PeriodKey;
  description: string;
  previousLabel: string;
  now: Totals;
  before: Totals;
  buckets: Bucket[];
  clients: TopClient[];
}

const margin = (t: Totals) => (t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0);

export default function DashboardScreen({ data }: { data: DashboardData }) {
  const router = useRouter();
  const { now, before } = data;

  return (
    <div className="space-y-5">
      {/* One row of filters, above everything they scope. */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => router.push(`/staff/dashboard?period=${p.key}`)}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${data.period === p.key
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-line hover:bg-parch'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[12px] text-mute ml-1">{data.description}</span>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={<Money value={now.revenue} />}
              now={now.revenue} before={before.revenue} against={data.previousLabel} />
        <Stat label="Profit" value={<Money value={now.profit} />}
              now={now.profit} before={before.profit} against={data.previousLabel} />
        <Stat label="Margin"
              value={<>{margin(now).toFixed(1)}<span className="text-[16px]">%</span></>}
              now={margin(now)} before={margin(before)} against={data.previousLabel}
              points />
        <Stat label="Orders" value={now.orders.toLocaleString('en-GB')}
              now={now.orders} before={before.orders} against={data.previousLabel} />
      </div>

      {now.uncostedLines > 0 && (
        <Notice tone="info">
          {now.uncostedLines} line{now.uncostedLines === 1 ? '' : 's'} in this period
          {now.uncostedLines === 1 ? ' has' : ' have'} no cost recorded, so
          {now.uncostedLines === 1 ? ' it counts' : ' they count'} as costing nothing and
          the profit above is flattered by however much they really cost.{' '}
          <Link href="/staff/import" className="text-ink font-semibold underline">
            Import a cost column
          </Link>{' '}
          and past orders are costed with it.
        </Notice>
      )}

      <Card>
        <div className="flex flex-wrap items-baseline gap-3 mb-1">
          <h2 className="text-[14px] font-semibold">Revenue, and what was left of it</h2>
          <span className="text-[12px] text-mute ml-auto">Net of VAT, by order date</span>
        </div>
        <div className="mb-3"><Legend /></div>
        <SalesChart data={data.buckets} />
      </Card>

      <Card>
        <h2 className="text-[14px] font-semibold mb-3">Orders</h2>
        <OrdersChart data={data.buckets} />
      </Card>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
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
                    <td className="num text-right"><Money value={b.revenue} /></td>
                    <td className="num text-right text-mute"><Money value={b.cost} /></td>
                    <td className="num text-right font-semibold"><Money value={b.profit} /></td>
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
                        <Money value={c.profit} />
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
