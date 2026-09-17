import { requirePartner } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, PageHeading } from '@/components/ui';
import { isPeriodKey, resolvePeriod } from '@/lib/reporting/period';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sales — IQ Sports Supply' };

const monthLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));

/**
 * The month-by-month statement, which is what gets invoiced against.
 *
 * The dashboard is for looking at; this is for adding up. Months with nothing
 * in them are listed rather than skipped, so a gap is visibly a quiet month
 * and not a month somebody forgot to send.
 */
export default async function BrandSales({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const user = await requirePartner();
  const sb = await supabaseServer();

  const { period } = await searchParams;
  const key = isPeriodKey(period) ? period : '12m';
  const p = resolvePeriod(key, new Date().toISOString().slice(0, 10));
  const showsMargin = user.brands.every((b) => b.showsMargin);
  const consignment = user.brands.some((b) => b.consignment);

  const { data } = await sb.rpc('partner_sales_by_month', { p_from: p.from, p_to: p.to });
  const months = ((data ?? []) as Record<string, unknown>[]).map((m) => ({
    month: String(m.month),
    units: Number(m.units),
    sales: Number(m.sales),
    due: Number(m.due_to_brand),
  }));

  const total = months.reduce(
    (a, m) => ({ units: a.units + m.units, sales: a.sales + m.sales, due: a.due + m.due }),
    { units: 0, sales: 0, due: 0 },
  );

  return (
    <>
      <PageHeading sub={consignment
        ? 'What sold each month and what we owe you for it. Figures are net of VAT and counted on the date each order was placed.'
        : 'What sold each month. Figures are net of VAT and counted on the date each order was placed.'}>
        Sales by month
      </PageHeading>

      {months.length === 0 ? (
        <Card><Empty>Nothing in this period.</Empty></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Units</th>
                  {showsMargin && <th className="text-right">Sold for</th>}
                  <th className="text-right">{consignment ? 'Due to you' : 'Your share'}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className={m.units === 0 ? 'text-mute' : ''}>
                    <td className="num whitespace-nowrap">{monthLabel(m.month)}</td>
                    <td className="num text-right">{m.units || '—'}</td>
                    {showsMargin && (
                      <td className="num text-right text-mute"><Money value={m.sales} /></td>
                    )}
                    <td className="num text-right font-semibold"><Money value={m.due} /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line">
                  <td className="font-semibold">{p.description}</td>
                  <td className="num text-right font-semibold">{total.units}</td>
                  {showsMargin && (
                    <td className="num text-right text-mute"><Money value={total.sales} /></td>
                  )}
                  <td className="num text-right font-semibold text-[15px]">
                    <Money value={total.due} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
