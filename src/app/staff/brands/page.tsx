import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import { fetchAll } from '@/lib/supabase/chunk';
import BrandsScreen, { type BrandRow } from './BrandsScreen';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Brand partners — IQ Sports Supply' };

/**
 * Who we sell for, who may look at it, and what they ship themselves.
 *
 * Only the brands we have a reason to set up appear as partners, but every
 * brand in the catalogue is listed: the useful question on this screen is
 * usually "have we given DRAG a login yet", and a screen that only shows the
 * ones already set up cannot answer it.
 */
export default async function BrandsPage() {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: brands }, { data: partners }, products, { data: settings }] =
    await Promise.all([
    sb.from('brands')
      .select('id, key, name, consignment, shows_margin, agency, agency_terms')
      .order('name'),
    sb.from('brand_partners')
      .select('id, brand_id, email, name, active, auth_user_id')
      .order('email'),
    fetchAll<{ id: string; sku: string; name: string; brand_id: string | null; dropship: boolean }>(
      (from, to) => sb.from('products')
        .select('id, sku, name, brand_id, dropship')
        .eq('active', true).order('sku').range(from, to)),
    sb.from('settings').select('company').eq('id', 1).single(),
  ]);

  const byBrand = new Map<string, BrandRow['products']>();
  for (const p of products) {
    if (!p.brand_id) continue;
    byBrand.set(p.brand_id, [...(byBrand.get(p.brand_id) ?? []),
      { id: p.id, sku: p.sku, name: p.name, dropship: p.dropship }]);
  }

  const rows: BrandRow[] = (brands ?? []).map((b) => ({
    id: b.id, name: b.name,
    consignment: b.consignment, showsMargin: b.shows_margin,
    agency: b.agency, agencyTerms: b.agency_terms ?? '',
    partners: (partners ?? []).filter((p) => p.brand_id === b.id).map((p) => ({
      id: p.id, email: p.email, name: p.name,
      active: p.active, signedIn: Boolean(p.auth_user_id),
    })),
    products: byBrand.get(b.id) ?? [],
  }));

  return (
    <>
      <PageHeading sub="A brand partner signs in and sees their own sales and nothing else — not our other brands, not our customers, not what anyone pays. Mark the lines they ship themselves and an order for one emails them straight away.">
        Brand partners
      </PageHeading>
      <BrandsScreen brands={rows} company={settings?.company ?? 'IQ Sports Supply'} />
    </>
  );
}
