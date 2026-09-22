import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/chunk';
import CollectionsBrowser from '../CollectionsBrowser';
import type { CategoryRow } from '@/lib/catalogue/tree';
import type { CatalogueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Catalogue — IQ Sports Supply' };

export default async function PortalCatalogue() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const [products, { data: categories }, { data: groupRows },
         { data: client }, { data: settings }] =
    await Promise.all([
    fetchAll((from, to) => sb.from('client_catalogue')
      .select(`id, sku, name, brand, series, price, moq, break_price, currency, price_note, in_stock, image_url,
               variant_group, variant_label, variant_sort,
               category_slug, category_name, configurator_only`)
      .order('sku').range(from, to)),
    sb.from('categories').select('id, slug, name, sort, parent_id').order('sort'),
    // Counted alongside the products: a builder is one thing to click.
    sb.from('product_groups').select('categories(slug)').eq('active', true),
    sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
  ]);

  return (
    <CollectionsBrowser
      products={products as CatalogueItem[]}
      categories={(categories ?? []) as CategoryRow[]}
      configurators={((groupRows ?? []) as unknown as { categories: { slug: string } | null }[])
        .map((g) => ({ categorySlug: g.categories?.slug ?? null }))}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
    />
  );
}
