'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { PERIODS, type PeriodKey } from '@/lib/reporting/period';
import { SalesChart, Legend, type Bucket } from '../staff/dashboard/Charts';

export interface BrandFigures {
  units: number; orders: number; sales: number;
  dueToBrand: number; distributorMargin: number; excludedLines: number;
}

export interface BrandData {
  period: PeriodKey;
  description: string;
  previousLabel: string;
  brandName: string;
  consignment: boolean;
  /** Whether what the goods sold for is shown, or only what the brand is owed. */
  showsMargin: boolean;
  now: BrandFigures;
  before: BrandFigures;
  months: { month: string; units: number; sales: number; dueToBrand: number }[];
  products: { sku: string; name: string; units: number; sales: number; dueToBrand: number }[];
  demographics: { kind: 'tier' | 'area'; label: string; buyers: number; sold: number; value: number }[];
  toDispatch: number;
}

const monthLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));

export default function BrandDashboard({ data }: { data: BrandData }) {
  const router = useRouter();
  const { now, before } = data;

  // Column height is what the goods sold for; the accent is the brand's share
  // of it. Their money is the emphasised one — this is their screen.
  const buckets: Bucket[] = data.months.map((m) => ({
    bucket: m.month,
    label: monthLabel(m.month),
    orders: 0,
    revenue: data.showsMargin ? m.sales : m.dueToBrand,
    cost: data.showsMargin ? m.sales - m.dueToBrand : 0,
    profit: m.dueToBrand,
  }));

  const tiers = data.demographics.filter((d) => d.kind === 'tier');
  const areas = data.demographics.filter((d) => d.kind === 'area');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => router.push(`/brand?period=${p.key}`)}
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

      {data.toDispatch > 0 && (
        <Notice tone="info">
          <strong>{data.toDispatch}</strong> order{data.toDispatch === 1 ? '' : 's'} waiting
          for you to dispatch.{' '}
          <Link href="/brand/dispatch" className="font-semibold underline">
            Open the dispatch list
          </Link>
        </Notice>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={data.consignment ? 'Due to you' : 'Your share'}
              value={<Money value={now.dueToBrand} />}
              now={now.dueToBrand} before={before.dueToBrand} against={data.previousLabel} />
        <Stat label="Units sold" value={now.units.toLocaleString('en-GB')}
              now={now.units} before={before.units} against={data.previousLabel} />
        {data.showsMargin ? (
          <Stat label="Sold for" value={<Money value={now.sales} />}
                now={now.sales} before={before.sales} against={data.previousLabel} />
        ) : (
          <Stat label="Orders" value={now.orders.toLocaleString('en-GB')}
                now={now.orders} before={before.orders} against={data.previousLabel} />
        )}
        <Stat label="Trade customers"
              value={String(tiers.reduce((a, t) => a + t.buyers, 0))}
              now={tiers.reduce((a, t) => a + t.buyers, 0)} before={0} against="" quiet />
      </div>

      {now.excludedLines > 0 && (
        <Notice tone="info">
          {now.excludedLines} line{now.excludedLines === 1 ? '' : 's'} of your products
          {now.excludedLines === 1 ? ' is' : ' are'} not in these figures, because we have
          no cost recorded against {now.excludedLines === 1 ? 'it' : 'them'} and so cannot
          say what is owed. Tell us and we will price {now.excludedLines === 1 ? 'it' : 'them'}.
        </Notice>
      )}

      <Card>
        <div className="flex flex-wrap items-baseline gap-3 mb-1">
          <h2 className="text-[14px] font-semibold">Month by month</h2>
          <span className="text-[12px] text-mute ml-auto">By the date each order was placed</span>
        </div>
        <div className="mb-3">
          <Legend
            accent={data.consignment ? 'Due to you' : 'Your share'}
            muted="Distributor margin"
            total={data.showsMargin ? 'Column height is what it sold for' : ''}
          />
        </div>
        <SalesChart
          data={buckets}
          rows={{
            total: data.showsMargin ? 'sold for' : 'due to you',
            accent: data.consignment ? 'due to you' : 'your share',
            muted: 'distributor margin',
          }}
        />
      </Card>

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4 items-start">
        <Card>
          <h2 className="text-[14px] font-semibold mb-3">Your products</h2>
          {data.products.length === 0 ? (
            <Empty>Nothing of yours sold in this period.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Product</th>
                    <th className="text-right">Units</th>
                    {data.showsMargin && <th className="text-right">Sold for</th>}
                    <th className="text-right">Due to you</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((p) => (
                    <tr key={p.sku}>
                      <td className="num">{p.sku}</td>
                      <td>{p.name}</td>
                      <td className="num text-right">{p.units}</td>
                      {data.showsMargin && (
                        <td className="num text-right text-mute"><Money value={p.sales} /></td>
                      )}
                      <td className="num text-right font-semibold">
                        <Money value={p.dueToBrand} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-[14px] font-semibold mb-2">Who buys it</h2>
            {tiers.length === 0 ? <Empty>No sales yet.</Empty> : (
              <Split rows={tiers} />
            )}
          </div>
          <div>
            <h2 className="text-[14px] font-semibold mb-2">Where it goes</h2>
            {areas.length === 0 ? <Empty>No sales yet.</Empty> : <Split rows={areas} />}
            <p className="text-[11px] text-mute mt-2 leading-relaxed">
              By postcode area. A region with fewer than three buyers in it is counted
              under &ldquo;Elsewhere&rdquo; — near enough to be useful, not near enough
              to name somebody&rsquo;s shop.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A share-of-total bar per row, which is what a demographic split is. */
function Split({ rows }: { rows: BrandData['demographics'] }) {
  const total = rows.reduce((a, r) => a + r.sold, 0) || 1;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={`${r.kind}-${r.label}`} className="text-[12px]">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{r.label}</span>
            <span className="text-mute num ml-auto">
              {r.sold} unit{r.sold === 1 ? '' : 's'} · {Math.round((r.sold / total) * 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-line rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-flame rounded-full"
                 style={{ width: `${Math.max(2, (r.sold / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, now, before, against, quiet = false }: {
  label: string; value: React.ReactNode;
  now: number; before: number; against: string; quiet?: boolean;
}) {
  const change = !quiet && before > 0 ? ((now - before) / before) * 100 : null;
  return (
    <Card>
      <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">{label}</div>
      <div className="text-[24px] font-semibold tracking-[-0.02em] num mt-1">{value}</div>
      {change !== null && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <Tag tone={change >= 0 ? 'green' : 'red'}>
            {change >= 0 ? '+' : ''}{change.toFixed(0)}%
          </Tag>
          <span className="text-mute">vs {against}</span>
        </div>
      )}
    </Card>
  );
}
