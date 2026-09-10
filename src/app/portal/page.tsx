import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import CatalogueBrowser from './CatalogueBrowser';

export const dynamic = 'force-dynamic';

export default async function PortalCatalogue() {
  const user = await requireClient();
  const sb = await supabaseServer();

  // client_catalogue exposes this client's tier price and a plain in-stock
  // boolean — never a quantity, never another tier's price.
  const [{ data: products }, { data: client }, { data: settings }] = await Promise.all([
    sb.from('client_catalogue')
      .select('id, sku, name, brand, price, in_stock, category_slug, category_name')
      .order('sku').limit(1000),
    sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
  ]);

  return (
    <CatalogueBrowser
      products={products ?? []}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
    />
  );
}
