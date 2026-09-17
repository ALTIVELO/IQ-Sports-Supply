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
  orders: number; revenue: string; cost: string; profit: string; uncosted_lines: number;
}
interface BucketRow {
  bucket: string; orders: number; revenue: string; cost: string; profit: string;
}
interface ClientRow {
  client_id: string; client_name: string; orders: number; revenue: string; profit: string;
}

const totals = (r: TotalsRow | undefined): Totals => ({
  orders: r?.orders ?? 0,
  revenue: Number(r?.revenue ?? 0),
  cost: Number(r?.cost ?? 0),
  profit: Number(r?.profit ?? 0),
  uncostedLines: r?.uncosted_lines ?? 0,
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
}: { searchParams: Promise<{ period?: string }> }) {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { period } = await searchParams;
  const key = isPeriodKey(period) ? period : '30d';
  const p = resolvePeriod(key, new Date().toISOString().slice(0, 10));

  const [nowRes, beforeRes, seriesRes, clientsRes] = await Promise.all([
    sb.rpc('sales_totals', { p_from: p.from, p_to: p.to }),
    sb.rpc('sales_totals', { p_from: p.previousFrom, p_to: p.previousTo }),
    sb.rpc('sales_over_time', { p_from: p.from, p_to: p.to, p_grain: p.grain }),
    sb.rpc('top_clients', { p_from: p.from, p_to: p.to, p_limit: 6 }),
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
    description: p.description,
    previousLabel: p.previousLabel,
    now: totals((nowRes.data ?? [])[0] as TotalsRow | undefined),
    before: totals((beforeRes.data ?? [])[0] as TotalsRow | undefined),
    buckets,
    clients,
  };

  return (
    <>
      <PageHeading sub="Revenue is net of VAT and recognised on the order date — an order placed in March that settles in April was March's work. Cancelled orders are not sales and are left out entirely.">
        Dashboard
      </PageHeading>
      <DashboardScreen data={data} />
    </>
  );
}
