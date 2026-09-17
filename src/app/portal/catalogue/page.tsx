import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import CollectionsBrowser from '../CollectionsBrowser';
import type { CategoryRow } from '@/lib/catalogue/tree';
import type { CatalogueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Catalogue — IQ Sports Supply' };

export default async function PortalCatalogue() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: products }, { data: categories }, { data: client }, { data: settings }] =
    await Promise.all([
    sb.from('client_catalogue')
      .select('id, sku, name, brand, price, in_stock, image_url, category_slug, category_name')
      .order('sku').limit(2000),
    sb.from('categories').select('id, slug, name, sort, parent_id').order('sort'),
    sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
  ]);

  return (
    <CollectionsBrowser
      products={(products ?? []) as CatalogueItem[]}
      categories={(categories ?? []) as CategoryRow[]}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
    />
  );
}
