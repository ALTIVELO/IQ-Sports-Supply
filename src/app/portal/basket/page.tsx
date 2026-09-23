import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/chunk';
import BasketReview from './BasketReview';
import type { Address } from '../account/AddressBook';
import type { AgencyBrand, CatalogueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  const user = await requireClient();
  const sb = await supabaseServer();

  // The basket holds only ids and quantities, so prices are read fresh here —
  // a basket left open overnight can never check out at yesterday's price.
  const [products, { data: client }, { data: settings }, { data: addresses },
         { data: agency }] =
    await Promise.all([
      // Every column the basket renders. Missing currency here would have
      // drawn a euro basket with pound signs on it, and missing the size would
      // have left two frames of one bike looking like the same line.
      fetchAll((from, to) => sb.from('client_catalogue')
        .select(`id, sku, name, brand, series, price, moq, break_price, currency, price_note, in_stock, image_url,
               variant_group, variant_label, variant_sort,
               category_slug, category_name, configurator_only`)
        .order('sku').range(from, to)),
      sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
      sb.from('settings').select('vat_rate, payment_days, company, dropship_terms').eq('id', 1).single(),
      sb.from('client_addresses')
        .select('id, label, recipient, address, is_default')
        .eq('client_id', user.clientId).eq('active', true)
        .order('is_default', { ascending: false }).order('created_at'),
      // The brands we introduce rather than sell. A client cannot read the
      // brands table — it holds the consignment arrangements — so this comes
      // back through a function that returns only the disclosure itself.
      sb.rpc('agency_brands'),
    ]);

  return (
    <BasketReview
      products={products as CatalogueItem[]}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
      paymentDays={Number(settings?.payment_days ?? 30)}
      addresses={(addresses ?? []) as Address[]}
      company={settings?.company ?? 'IQ Sports Supply'}
      dropshipTerms={settings?.dropship_terms ?? ''}
      agencyBrands={(agency ?? []) as AgencyBrand[]}
    />
  );
}
