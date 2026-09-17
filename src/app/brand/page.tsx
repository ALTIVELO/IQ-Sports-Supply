import { requirePartner } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import { isPeriodKey, resolvePeriod } from '@/lib/reporting/period';
import BrandDashboard, { type BrandData } from './BrandDashboard';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your sales — IQ Sports Supply' };

/**
 * What a brand sold through us, month by month.
 *
 * Every figure comes from a partner_* function, which narrows to the brands on
 * this login before it counts anything. Nothing on this page is filtered in
 * JavaScript — a filter on the client is a filter somebody can remove.
 */
export default async function BrandHome({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const user = await requirePartner();
  const sb = await supabaseServer();

  const { period } = await searchParams;
  const key = isPeriodKey(period) ? period : '12m';
  const p = resolvePeriod(key, new Date().toISOString().slice(0, 10));

  const [totals, before, months, top, demo, dispatch] = await Promise.all([
    sb.rpc('partner_sales_totals', { p_from: p.from, p_to: p.to }),
    sb.rpc('partner_sales_totals', { p_from: p.previousFrom, p_to: p.previousTo }),
    sb.rpc('partner_sales_by_month', { p_from: p.from, p_to: p.to }),
    sb.rpc('partner_top_products', { p_from: p.from, p_to: p.to, p_limit: 8 }),
    sb.rpc('partner_demographics', { p_from: p.from, p_to: p.to }),
    sb.rpc('partner_dropship_orders'),
  ]);

  const one = (rows: unknown) => (rows as Record<string, unknown>[] | null)?.[0];
  const figures = (r: Record<string, unknown> | undefined) => ({
    units: Number(r?.units ?? 0),
    orders: Number(r?.orders ?? 0),
    sales: Number(r?.sales ?? 0),
    dueToBrand: Number(r?.due_to_brand ?? 0),
    distributorMargin: Number(r?.distributor_margin ?? 0),
    excludedLines: Number(r?.excluded_lines ?? 0),
  });

  const data: BrandData = {
    period: key,
    description: p.description,
    previousLabel: p.previousLabel,
    brandName: user.brands.map((b) => b.brandName).join(' · '),
    consignment: user.brands.some((b) => b.consignment),
    // One brand withholding it withholds it: a combined figure would otherwise
    // tell them what they were not meant to be told.
    showsMargin: user.brands.every((b) => b.showsMargin),
    now: figures(one(totals.data)),
    before: figures(one(before.data)),
    months: ((months.data ?? []) as Record<string, unknown>[]).map((m) => ({
      month: String(m.month),
      units: Number(m.units),
      sales: Number(m.sales),
      dueToBrand: Number(m.due_to_brand),
    })),
    products: ((top.data ?? []) as Record<string, unknown>[]).map((r) => ({
      sku: String(r.sku), name: String(r.name),
      units: Number(r.units), sales: Number(r.sales), dueToBrand: Number(r.due_to_brand),
    })),
    demographics: ((demo.data ?? []) as Record<string, unknown>[]).map((r) => ({
      kind: String(r.kind) as 'tier' | 'area',
      label: String(r.label), buyers: Number(r.buyers),
      sold: Number(r.sold), value: Number(r.value),
    })),
    toDispatch: (dispatch.data ?? []).length,
  };

  return (
    <>
      <PageHeading sub="What your products sold through IQ, by the date each order was placed. Cancelled orders are not sales, and a line we have not costed is left out of every figure rather than counted at nothing.">
        {data.brandName}
      </PageHeading>
      <BrandDashboard data={data} />
    </>
  );
}
