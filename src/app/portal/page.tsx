import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { buildTree, offeredLoose, type CategoryRow } from '@/lib/catalogue/tree';
import HomeScreen, { type HomeData } from './HomeScreen';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Home — IQ Sports Supply' };

/** A proforma asks for nothing and a credit note is money the other way. */
const PAYABLE = ['full', 'shipment', 'backorder'];

/** Reads what a customer's landing page needs, and hands it to the screen. */
export default async function PortalHome() {
  const user = await requireClient();
  const sb = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: client }, { data: due }, { data: orders }, { data: shipped },
         { data: groups }, { data: filed }, { data: categories }] =
    await Promise.all([
      sb.from('clients').select('name, tiers(name)').eq('id', user.clientId).single(),

      sb.from('invoices')
        .select('id, number, due_date, vat_rate, currency, invoice_lines(qty, unit_price)')
        .eq('client_id', user.clientId)
        .eq('superseded', false).eq('paid', false)
        .in('type', PAYABLE)
        .order('due_date'),

      sb.from('orders')
        .select(`id, number, date, status, currency,
                 order_lines(id, qty, unit_price),
                 invoices(id, shipped, delivered, superseded)`)
        .eq('client_id', user.clientId)
        .order('date', { ascending: false })
        .limit(6),

      sb.from('invoices')
        .select('id, number, shipped_at, carrier, tracking_number, tracking_url, orders(number)')
        .eq('client_id', user.clientId)
        .eq('shipped', true).eq('superseded', false)
        .order('shipped_at', { ascending: false })
        .limit(1),

      // Every active builder: four are shown as cards, all of them are counted
      // into the departments below.
      sb.from('product_groups')
        .select('slug, name, brand, image_url, categories(slug)')
        .eq('active', true).order('sort'),

      // Two columns, not nine: this only needs to count what is filed where.
      sb.from('client_catalogue')
        .select('category_slug, image_url, configurator_only').limit(2000),

      sb.from('categories').select('id, slug, name, sort, parent_id').order('sort'),
    ]);

  const gross = (i: { vat_rate: number; invoice_lines: { qty: number; unit_price: number }[] }) =>
    i.invoice_lines.reduce((s, l) => s + l.qty * Number(l.unit_price), 0)
      * (1 + Number(i.vat_rate) / 100);

  const overdue = (due ?? []).filter((i) => i.due_date < today);

  // A cancelled order is still listed, struck through, but it is not one of the
  // orders on their way to you. "On their way" now runs to delivered, not just
  // shipped — a parcel in transit is still in progress.
  const inProgress = (orders ?? []).filter((o) => {
    if (o.status === 'cancelled') return false;
    const live = o.invoices.filter((i) => !i.superseded);
    return live.length === 0 || live.some((i) => !i.delivered);
  });

  const parcel = shipped?.[0];

  const data: HomeData = {
    clientName: client?.name ?? '',
    tier: (client?.tiers as unknown as { name: string } | null)?.name ?? null,
    productCount: (filed ?? []).filter(offeredLoose).length,
    // Per currency. One entry is the ordinary case and reads exactly as the
    // single figure did; two means two debts, and adding them would state a
    // balance that is owed to nobody.
    outstanding: [...(due ?? []).reduce((m, i) => {
      const code = i.currency ?? 'GBP';
      return m.set(code, (m.get(code) ?? 0) + gross(i));
    }, new Map<string, number>())].map(([currency, value]) => ({ currency, value })),
    dueCount: (due ?? []).length,
    overdueCount: overdue.length,
    earliestOverdue: overdue[0]?.due_date ?? null,
    inProgressCount: inProgress.length,
    orders: (orders ?? []).slice(0, 5) as HomeData['orders'],
    parcel: parcel
      ? {
          id: parcel.id, number: parcel.number, shipped_at: parcel.shipped_at,
          carrier: parcel.carrier, tracking_number: parcel.tracking_number,
          tracking_url: parcel.tracking_url,
          orderNumber: (parcel.orders as unknown as { number: string } | null)?.number ?? null,
        }
      : null,
    groups: (groups ?? []).slice(0, 4).map((g) => ({
      slug: g.slug, name: g.name, brand: g.brand, image_url: g.image_url,
    })),
    departments: buildTree(
      (categories ?? []) as CategoryRow[], filed ?? [],
      ((groups ?? []) as unknown as { categories: { slug: string } | null }[])
        .map((g) => ({ categorySlug: g.categories?.slug ?? null })))
      .filter((n) => n.total > 0)
      .map((n) => ({ slug: n.slug, name: n.name, total: n.total })),
  };

  return <HomeScreen data={data} />;
}
