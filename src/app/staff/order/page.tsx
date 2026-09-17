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

  const [{ data: clients }, { data: locations }, { data: products }, { data: prices }, { data: stock }] =
    await Promise.all([
      sb.from('clients')
        .select('id, name, tier_id, address, vat_exempt, default_location_id, email')
        .eq('active', true).order('name'),
      sb.from('locations').select('id, name').eq('active', true).order('name'),
      sb.from('products')
        .select(`id, sku, name, brand, currency, category_id,
                 variant_group, variant_label, variant_sort`)
        .eq('active', true).order('sku'),
      sb.from('tier_prices').select('product_id, tier_id, price, effective_from')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false }),
      sb.from('stock_levels').select('product_id, location_id, qty'),
    ]);

  const [{ data: tiers }, { data: settings }, { data: categories }, { data: groups }] =
    await Promise.all([
      sb.from('tiers').select('id, name').order('sort'),
      sb.from('settings').select('vat_rate').eq('id', 1).single(),
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
        builds={toBuilds(groups ?? [])}
        vatRate={Number(settings?.vat_rate ?? 20)}
      />
    </>
  );
}
