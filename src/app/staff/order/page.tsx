import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import OrderDesk from './OrderDesk';

export const dynamic = 'force-dynamic';

export interface DeskProduct {
  id: string; sku: string; name: string; brand: string | null;
  /** The money this product's prices are in. One order holds one of these. */
  currency: string;
  /** Which collection it is filed under, so the desk can be browsed, not only searched. */
  category_id: string | null;
  /** Its frame size, where it is one size of a bike. */
  variant_label: string | null;
  /** Price per tier, so switching client repricing is instant. */
  prices: Record<string, number>;
  /** Stock per location — staff see every site so they can switch or transfer. */
  stock: Record<string, number>;
}

export default async function OrderDeskPage() {
  await requireStaff();
  const sb = await supabaseServer();

  const [{ data: clients }, { data: locations }, { data: products }, { data: prices }, { data: stock }] =
    await Promise.all([
      sb.from('clients')
        .select('id, name, tier_id, address, vat_exempt, default_location_id, email')
        .eq('active', true).order('name'),
      sb.from('locations').select('id, name').eq('active', true).order('name'),
      sb.from('products')
        .select('id, sku, name, brand, currency, category_id, variant_label')
        .eq('active', true).order('sku'),
      sb.from('tier_prices').select('product_id, tier_id, price, effective_from')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false }),
      sb.from('stock_levels').select('product_id, location_id, qty'),
    ]);

  const [{ data: tiers }, { data: settings }, { data: categories }] = await Promise.all([
    sb.from('tiers').select('id, name').order('sort'),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
    sb.from('categories').select('id, name, slug, sort, parent_id').order('sort'),
  ]);

  // Current price = the most recent row effective today, per product and tier.
  const priceMap = new Map<string, Record<string, number>>();
  for (const row of prices ?? []) {
    const forProduct = priceMap.get(row.product_id) ?? {};
    if (forProduct[row.tier_id] === undefined) forProduct[row.tier_id] = Number(row.price);
    priceMap.set(row.product_id, forProduct);
  }

  const stockMap = new Map<string, Record<string, number>>();
  for (const row of stock ?? []) {
    const forProduct = stockMap.get(row.product_id) ?? {};
    forProduct[row.location_id] = row.qty;
    stockMap.set(row.product_id, forProduct);
  }

  const deskProducts: DeskProduct[] = (products ?? []).map((p) => ({
    ...p,
    prices: priceMap.get(p.id) ?? {},
    stock: stockMap.get(p.id) ?? {},
  }));

  return (
    <>
      <PageHeading sub="Take a client order — prices pull automatically from their tier, allocation draws from the chosen fulfilment site, and anything short goes straight to back order and to the supplier.">
        Order desk
      </PageHeading>
      <OrderDesk
        clients={clients ?? []}
        locations={locations ?? []}
        tiers={tiers ?? []}
        products={deskProducts}
        categories={(categories ?? []) as never}
        vatRate={Number(settings?.vat_rate ?? 20)}
      />
    </>
  );
}
