import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui';
import BasketBar from '../../BasketBar';
import CollectionSearch from './CollectionSearch';
import type { CatalogueItem } from '../../page';

export const dynamic = 'force-dynamic';

/** One collection's products. `other` gathers everything not yet categorised. */
export default async function Collection({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: all }, { data: client }, { data: settings }] = await Promise.all([
    sb.from('client_catalogue')
      .select('id, sku, name, brand, price, in_stock, image_url, category_slug, category_name')
      .order('sku').limit(2000),
    sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
    sb.from('settings').select('vat_rate').eq('id', 1).single(),
  ]);

  const products = (all ?? []) as CatalogueItem[];
  const inCollection = slug === 'other'
    ? products.filter((p) => !p.category_slug)
    : products.filter((p) => p.category_slug === slug);

  // An empty collection means a bad URL, not an empty shelf — every collection
  // shown on the landing page has at least one product in it by construction.
  if (inCollection.length === 0) notFound();

  const title = slug === 'other' ? 'Other' : inCollection[0].category_name ?? slug;
  const vatRate = client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/portal" className="text-[12px] text-flame-text font-semibold">
          ← All collections
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] mt-1.5">{title}</h1>
        <p className="text-[13px] text-mute mt-1">
          {inCollection.length} product{inCollection.length === 1 ? '' : 's'} ·{' '}
          {inCollection.filter((p) => p.in_stock).length} in stock
        </p>
      </div>

      {inCollection.length === 0 ? (
        <Card><Empty>Nothing in this collection yet.</Empty></Card>
      ) : (
        <CollectionSearch products={inCollection} />
      )}

      <BasketBar products={products} vatRate={vatRate} />
    </div>
  );
}
