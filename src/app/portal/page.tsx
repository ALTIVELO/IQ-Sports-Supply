import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import CollectionsBrowser from './CollectionsBrowser';

export const dynamic = 'force-dynamic';

export interface CatalogueItem {
  id: string; sku: string; name: string; brand: string | null;
  price: number; in_stock: boolean; image_url: string | null;
  category_slug: string | null; category_name: string | null;
}

export default async function PortalCatalogue() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: products }, { data: client }, { data: settings }] = await Promise.all([
    sb.from('client_catalogue')
      .select('id, sku, name, brand, price, in_stock, image_url, category_slug, category_name')
      .order('sku').limit(2000),
    sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
  ]);

  return (
    <CollectionsBrowser
      products={(products ?? []) as CatalogueItem[]}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
    />
  );
}
