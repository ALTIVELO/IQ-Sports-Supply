import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import OrderDesk from './OrderDesk';
import { fetchAll, inChunks } from '@/lib/supabase/chunk';
import type { AgencyBrand } from '@/lib/types';

export const dynamic = 'force-dynamic';

export interface DeskProduct {
  id: string; sku: string; name: string; brand: string | null;
  /** The money this product's prices are in. One order holds one of these. */
  currency: string;
  /** Which collection it is filed under, so the desk can be browsed, not only searched. */
  category_id: string | null;
  /** Its photo, where it has one. Most of the catalogue still does not. */
  image_url: string | null;
  /** Its frame size, where it is one size of a bike. */
  variant_label: string | null;
  /** Shared by every size of one bike, so the desk can offer it as one row. */
  variant_group: string | null;
  variant_sort: number | null;
  /** Price per tier, so switching client repricing is instant. */
  prices: Record<string, number>;
  /** Stock per location — staff see every site so they can switch or transfer. */
  stock: Record<string, number>;
}

/** One step of a build, with the products it offers. */
export interface DeskStep {
  id: string; name: string; hint: string | null;
  qty: number; required: boolean;
  axis1_name: string | null; axis2_name: string | null;
  options: {
    id: string; product_id: string; label: string | null;
    axis1_value: string | null; axis2_value: string | null;
  }[];
}

export interface DeskBuild {
  id: string; slug: string; name: string; brand: string | null;
  category_id: string | null;
  steps: DeskStep[];
}

/** Sorts the nested rows Supabase returns in whatever order it likes. */
function toBuilds(rows: unknown[]): DeskBuild[] {
  type Row = DeskBuild & {
    product_group_steps: (DeskStep & { sort: number; product_group_options: (DeskStep['options'][number] & { sort: number })[] })[];
  };
  return (rows as Row[]).map((g) => ({
    id: g.id, slug: g.slug, name: g.name, brand: g.brand, category_id: g.category_id,
    steps: [...(g.product_group_steps ?? [])]
      .sort((a, b) => a.sort - b.sort)
      .map((s) => ({
        id: s.id, name: s.name, hint: s.hint, qty: s.qty, required: s.required,
        axis1_name: s.axis1_name, axis2_name: s.axis2_name,
        options: [...(s.product_group_options ?? [])]
          .sort((a, b) => a.sort - b.sort)
          .map((o) => ({
            id: o.id, product_id: o.product_id, label: o.label,
            axis1_value: o.axis1_value, axis2_value: o.axis2_value,
          })),
      })),
  }));
}

export default async function OrderDeskPage() {
  await requireStaff();
  const sb = await supabaseServer();

  const [{ data: clients }, { data: locations }, products] = await Promise.all([
    sb.from('clients')
      .select('id, name, tier_id, address, vat_exempt, default_location_id, email')
      .eq('active', true).order('name'),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
    fetchAll((from, to) => sb.from('products')
      .select(`id, sku, name, brand, currency, category_id, image_url,
               variant_group, variant_label, variant_sort`)
      .eq('active', true).order('sku').range(from, to)),
  ]);

  const [{ data: tiers }, { data: settings }, { data: categories }, { data: groups },
         { data: agency }] =
    await Promise.all([
      sb.from('tiers').select('id, name').order('sort'),
      sb.from('settings').select('vat_rate, company').eq('id', 1).single(),
      sb.from('categories').select('id, name, slug, sort, parent_id').order('sort'),
      // The build structure only — no prices. What a component costs this
      // client comes from the same tier table the rest of the desk uses, so a
      // build can never quote a figure the desk would not honour.
      sb.from('product_groups')
        .select(`id, slug, name, brand, category_id,
                 product_group_steps(id, name, hint, qty, required, sort,
                                     axis1_name, axis2_name,
                                     product_group_options(id, product_id, label, sort,
                                                           axis1_value, axis2_value))`)
        .eq('active', true).order('sort'),
      // The brands whose orders we introduce, so the desk can say so before
      // the person on the phone has quoted anything.
      sb.rpc('agency_brands'),
    ]);

  // The price in force per product and tier, asked for in batches. Reading the
  // whole of tier_prices and keeping the newest row per product in JavaScript
  // is what left this screen saying there was no price: the response is capped
  // at a thousand rows, so one import of a few hundred same-dated prices
  // filled it and pushed every older price out of the answer.
  const ids = products.map((p) => p.id);
  const [priceRows, stockRows] = await Promise.all([
    inChunks<{ product_id: string; tier_id: string; price: number }>(
      ids, Math.max(1, (tiers ?? []).length),
      (batch) => sb.rpc('current_tier_prices', { p_products: batch })),
    inChunks<{ product_id: string; location_id: string; qty: number }>(
      ids, Math.max(1, (locations ?? []).length),
      (batch) => sb.from('stock_levels')
        .select('product_id, location_id, qty').in('product_id', batch)),
  ]);

  const priceMap = new Map<string, Record<string, number>>();
  for (const row of priceRows) {
    const forProduct = priceMap.get(row.product_id) ?? {};
    forProduct[row.tier_id] = Number(row.price);
    priceMap.set(row.product_id, forProduct);
  }

  const stockMap = new Map<string, Record<string, number>>();
  for (const row of stockRows) {
    const forProduct = stockMap.get(row.product_id) ?? {};
    forProduct[row.location_id] = row.qty;
    stockMap.set(row.product_id, forProduct);
  }

  const deskProducts: DeskProduct[] = products.map((p) => ({
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
        builds={toBuilds(groups ?? [])}
        vatRate={Number(settings?.vat_rate ?? 20)}
        company={settings?.company ?? 'IQ Sports Supply'}
        agencyBrands={(agency ?? []) as AgencyBrand[]}
      />
    </>
  );
}
