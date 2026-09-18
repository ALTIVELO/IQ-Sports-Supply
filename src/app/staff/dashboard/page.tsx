import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import { isPeriodKey, resolvePeriod, type Grain } from '@/lib/reporting/period';
import DashboardScreen, {
  type DashboardData, type Totals, type TopClient,
} from './DashboardScreen';
import type { Bucket } from './Charts';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard — IQ Sports Supply' };

interface TotalsRow {
  orders: number; revenue: string; cost: string; profit: string;
  excluded_lines: number; excluded_revenue: string;
}
interface BucketRow {
  bucket: string; orders: number; revenue: string; cost: string; profit: string;
}
interface ClientRow {
  client_id: string; client_name: string; orders: number; revenue: string; profit: string;
}
interface AgencyRow {
  brand_id: string; brand_name: string; orders: number;
  goods: string; rate: string | null; commission: string;
}

const totals = (r: TotalsRow | undefined): Totals => ({
  orders: r?.orders ?? 0,
  revenue: Number(r?.revenue ?? 0),
  cost: Number(r?.cost ?? 0),
  profit: Number(r?.profit ?? 0),
  excludedLines: r?.excluded_lines ?? 0,
  excludedRevenue: Number(r?.excluded_revenue ?? 0),
});

/** A bucket's label: the date for a day, the week's Monday, the month's name. */
function bucketLabel(day: string, grain: Grain) {
  const d = new Date(`${day}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = grain === 'month'
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}

/**
 * What the business did, over a period.
 *
 * All of the arithmetic is in Postgres — one call per figure rather than
 * pulling every order line across the wire and adding it up here, which would
 * also mean two places that could disagree about what a sale is.
 */
export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ period?: string; currency?: string }> }) {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { period, currency } = await searchParams;
  const key = isPeriodKey(period) ? period : '30d';
  const p = resolvePeriod(key, new Date().toISOString().slice(0, 10));

  // Which currencies there is anything to report on at all. A business that
  // only ever sells in pounds gets no control and no choice to make; one that
  // sells in two gets one report per currency, never a sum of both.
  const { data: sold } = await sb.rpc('sold_currencies');
  const currencies = ((sold ?? []) as { currency: string }[]).map((r) => r.currency);
  if (!currencies.length) currencies.push('GBP');
  const money = currency && currencies.includes(currency) ? currency : currencies[0];

  const [nowRes, beforeRes, seriesRes, clientsRes, agencyRes] = await Promise.all([
    sb.rpc('sales_totals', { p_from: p.from, p_to: p.to, p_currency: money }),
    sb.rpc('sales_totals', { p_from: p.previousFrom, p_to: p.previousTo, p_currency: money }),
    sb.rpc('sales_over_time',
           { p_from: p.from, p_to: p.to, p_grain: p.grain, p_currency: money }),
    sb.rpc('top_clients', { p_from: p.from, p_to: p.to, p_limit: 6, p_currency: money }),
    // Introduced business is not in any of the figures above — the goods were
    // never ours to sell. It is reported here as what it is: the goods the
    // brand invoiced, and the commission they owe us for the introduction.
    sb.rpc('agency_commission', { p_from: p.from, p_to: p.to, p_currency: money }),
  ]);

  const buckets: Bucket[] = ((seriesRes.data ?? []) as BucketRow[]).map((r) => ({
    bucket: r.bucket,
    label: bucketLabel(r.bucket, p.grain),
    orders: r.orders,
    revenue: Number(r.revenue),
    cost: Number(r.cost),
    profit: Number(r.profit),
  }));

  const clients: TopClient[] = ((clientsRes.data ?? []) as ClientRow[]).map((r) => ({
    clientId: r.client_id, name: r.client_name, orders: r.orders,
    revenue: Number(r.revenue), profit: Number(r.profit),
  }));

  const data: DashboardData = {
    period: key,
    currency: money,
    currencies,
    description: p.description,
    previousLabel: p.previousLabel,
    now: totals((nowRes.data ?? [])[0] as TotalsRow | undefined),
    before: totals((beforeRes.data ?? [])[0] as TotalsRow | undefined),
    buckets,
    clients,
    agency: ((agencyRes.data ?? []) as AgencyRow[]).map((r) => ({
      brandId: r.brand_id, name: r.brand_name, orders: r.orders,
      goods: Number(r.goods),
      rate: r.rate === null ? null : Number(r.rate),
      commission: Number(r.commission),
    })),
  };

  return (
    <>
      <PageHeading sub="Revenue is net of VAT and recognised on the order date — an order placed in March that settles in April was March's work. Cancelled orders are not sales, and a line we have no cost for is left out of every figure rather than counted as free. Orders we introduced to a brand are not our sales at all and are reported separately.">
        Dashboard
      </PageHeading>
      <DashboardScreen data={data} />
    </>
  );
}
