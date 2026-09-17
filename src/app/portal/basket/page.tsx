import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import BasketReview from './BasketReview';
import type { Address } from '../account/AddressBook';
import type { CatalogueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  const user = await requireClient();
  const sb = await supabaseServer();

  // The basket holds only ids and quantities, so prices are read fresh here —
  // a basket left open overnight can never check out at yesterday's price.
  const [{ data: products }, { data: client }, { data: settings }, { data: addresses }] =
    await Promise.all([
      sb.from('client_catalogue')
        .select('id, sku, name, brand, price, in_stock, image_url, category_slug, category_name')
        .order('sku').limit(2000),
      sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
      sb.from('settings').select('vat_rate, payment_days').eq('id', 1).single(),
      sb.from('client_addresses')
        .select('id, label, recipient, address, is_default')
        .eq('client_id', user.clientId).eq('active', true)
        .order('is_default', { ascending: false }).order('created_at'),
    ]);

  return (
    <BasketReview
      products={(products ?? []) as CatalogueItem[]}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
      paymentDays={Number(settings?.payment_days ?? 30)}
      addresses={(addresses ?? []) as Address[]}
    />
  );
}
