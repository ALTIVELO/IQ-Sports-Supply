import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import CatalogueScreen from './CatalogueScreen';

export const dynamic = 'force-dynamic';

export default async function CataloguePage({
  searchParams,
}: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  await requireStaff();
  const { q, tab } = await searchParams;
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: locations }] = await Promise.all([
    sb.from('tiers').select('id, name').order('sort'),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
  ]);

  let productQuery = sb.from('products').select('id, sku, name, brand, active').order('sku').limit(500);
  if (q?.trim()) productQuery = productQuery.or(`sku.ilike.%${q.trim()}%,name.ilike.%${q.trim()}%,brand.ilike.%${q.trim()}%`);

  const [{ data: products }, { data: prices }, { data: stock }, { data: transfers }] =
    await Promise.all([
      productQuery,
      sb.from('tier_prices').select('product_id, tier_id, price, effective_from')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false }),
      sb.from('stock_levels').select('product_id, location_id, qty'),
      sb.from('stock_transfers')
        .select('id, number, date, status, from_location_id, to_location_id, stock_transfer_lines(id, sku, name, qty)')
        .order('date', { ascending: false }).limit(20),
    ]);

  const priceMap: Record<string, Record<string, number>> = {};
  for (const r of prices ?? []) {
    priceMap[r.product_id] ??= {};
    if (priceMap[r.product_id][r.tier_id] === undefined) {
      priceMap[r.product_id][r.tier_id] = Number(r.price);
    }
  }

  const stockMap: Record<string, Record<string, number>> = {};
  for (const r of stock ?? []) {
    stockMap[r.product_id] ??= {};
    stockMap[r.product_id][r.location_id] = r.qty;
  }

  return (
    <>
      <PageHeading sub="Every SKU with a price per tier and stock held per site. Client-facing prices come from here; supplier orders never carry them. Bulk price changes belong on the Import screen.">
        Catalogue
      </PageHeading>
      <CatalogueScreen
        products={products ?? []}
        tiers={tiers ?? []}
        locations={locations ?? []}
        prices={priceMap}
        stock={stockMap}
        transfers={(transfers ?? []) as never}
        query={q ?? ''}
        tab={tab === 'transfers' ? 'transfers' : 'catalogue'}
      />
    </>
  );
}
