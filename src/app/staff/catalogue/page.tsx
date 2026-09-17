import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import CatalogueScreen from './CatalogueScreen';
import { groupCollections, idsUnderSlug } from '@/lib/catalogue/collections';

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
  const { data: filed } = await sb.from('products').select('category_id').limit(10000);
  const counts = new Map<string, number>();
  let uncategorisedTotal = 0;
  for (const row of filed ?? []) {
    if (!row.category_id) { uncategorisedTotal += 1; continue; }
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  let productQuery = sb.from('products')
    .select('id, sku, name, brand, active, category_id, image_url, currency, variant_label')
    .order('sku').limit(500);
  if (q?.trim()) productQuery = productQuery.or(`sku.ilike.%${q.trim()}%,name.ilike.%${q.trim()}%,brand.ilike.%${q.trim()}%`);
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

  const todayISO = new Date().toISOString().slice(0, 10);

  const [{ data: products }, { data: prices }, { data: costs }, { data: stock }, { data: transfers }] =
    await Promise.all([
      productQuery,
      sb.from('tier_prices').select('product_id, tier_id, price, effective_from')
        .lte('effective_from', todayISO)
        .order('effective_from', { ascending: false }),
      sb.from('product_costs').select('product_id, cost, effective_from')
        .lte('effective_from', todayISO)
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

  // Latest row first, so the first one seen for a product is the one in force.
  const costMap: Record<string, number> = {};
  for (const r of costs ?? []) {
    if (costMap[r.product_id] === undefined) costMap[r.product_id] = Number(r.cost);
  }

  const stockMap: Record<string, Record<string, number>> = {};
  for (const r of stock ?? []) {
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
