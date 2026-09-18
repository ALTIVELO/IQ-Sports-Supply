import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import CatalogueScreen from './CatalogueScreen';
import { groupCollections, idsUnderSlug } from '@/lib/catalogue/collections';
import { fetchAll, inChunks } from '@/lib/supabase/chunk';

export const dynamic = 'force-dynamic';

export default async function CataloguePage({
  searchParams,
}: { searchParams: Promise<{ q?: string; tab?: string; collection?: string }> }) {
  const user = await requireStaff();
  const { q, tab, collection } = await searchParams;
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: locations }, { data: categories }] = await Promise.all([
    sb.from('tiers').select('id, name').order('sort'),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
    sb.from('categories').select('id, name, slug, sort, parent_id').order('sort'),
  ]);

  // Every product's collection, for the counts on the picker. One column, so
  // it stays cheap even at a few thousand SKUs — and it has to be the whole
  // catalogue rather than the filtered page, or the counts would change every
  // time somebody typed in the search box.
  const filed = await fetchAll<{ category_id: string | null }>(
    (from, to) => sb.from('products').select('category_id').order('sku').range(from, to));
  const counts = new Map<string, number>();
  let uncategorisedTotal = 0;
  for (const row of filed) {
    if (!row.category_id) { uncategorisedTotal += 1; continue; }
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  let productQuery = sb.from('products')
    .select(`id, sku, name, brand, series, active, category_id, image_url, currency,
             variant_group, variant_label, variant_sort`)
    .order('sku').limit(500);
  if (q?.trim()) productQuery = productQuery.or(
    `sku.ilike.%${q.trim()}%,name.ilike.%${q.trim()}%,brand.ilike.%${q.trim()}%,` +
    `series.ilike.%${q.trim()}%`);
  // Filtered in the database rather than after the fact: the 500-row limit is
  // on what comes back, so filtering here would show the first 500 SKUs of the
  // whole catalogue and then hide most of them.
  if (collection === 'none') {
    productQuery = productQuery.is('category_id', null);
  } else if (collection) {
    const ids = idsUnderSlug((categories ?? []) as never, collection);
    // A slug nothing matches returns nothing, rather than silently everything.
    productQuery = productQuery.in('category_id', ids.length ? ids : ['']);
  }

  const [{ data: products }, { data: transfers }] = await Promise.all([
    productQuery,
    sb.from('stock_transfers')
      .select('id, number, date, status, from_location_id, to_location_id, stock_transfer_lines(id, sku, name, qty)')
      .order('date', { ascending: false }).limit(20),
  ]);

  // Only for the products on this page, and only the figure in force. Reading
  // the whole of tier_prices and picking the newest row per product in
  // JavaScript is what broke: the response is capped, so once one import wrote
  // a few hundred same-dated rows they filled it and every older price fell
  // off the end — silently, because a truncated response looks like a short one.
  const shown = (products ?? []).map((p) => p.id);
  const tierCount = Math.max(1, (tiers ?? []).length);
  const [priceRows, costRows, stockRows] = await Promise.all([
    inChunks<{ product_id: string; tier_id: string; price: number }>(
      shown, tierCount,
      (batch) => sb.rpc('current_tier_prices', { p_products: batch })),
    inChunks<{ product_id: string; cost: number }>(
      shown, 1,
      (batch) => sb.rpc('current_costs', { p_products: batch })),
    inChunks<{ product_id: string; location_id: string; qty: number }>(
      shown, Math.max(1, (locations ?? []).length),
      (batch) => sb.from('stock_levels')
        .select('product_id, location_id, qty').in('product_id', batch)),
  ]);

  const priceMap: Record<string, Record<string, number>> = {};
  for (const r of priceRows) {
    priceMap[r.product_id] ??= {};
    priceMap[r.product_id][r.tier_id] = Number(r.price);
  }

  const costMap: Record<string, number> = {};
  for (const r of costRows) costMap[r.product_id] = Number(r.cost);

  const stockMap: Record<string, Record<string, number>> = {};
  for (const r of stockRows) {
    stockMap[r.product_id] ??= {};
    stockMap[r.product_id][r.location_id] = r.qty;
  }

  return (
    <>
      <PageHeading sub="Every SKU with what it costs us, a price per tier and stock held per site. Client-facing prices come from here; supplier orders never carry them. Bulk price changes belong on the Import screen.">
        Catalogue
      </PageHeading>
      <CatalogueScreen
        products={products ?? []}
        tiers={tiers ?? []}
        locations={locations ?? []}
        prices={priceMap}
        costs={costMap}
        stock={stockMap}
        transfers={(transfers ?? []) as never}
        categories={categories ?? []}
        collections={groupCollections((categories ?? []) as never, counts)}
        uncategorisedTotal={uncategorisedTotal}
        collection={collection ?? null}
        canDelete={user.role === 'admin' || user.role === 'accounts'}
        query={q ?? ''}
        tab={tab === 'transfers' ? 'transfers' : 'catalogue'}
      />
    </>
  );
}
