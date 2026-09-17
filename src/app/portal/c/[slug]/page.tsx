import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty } from '@/components/ui';
import { buildTree, findNode, offeredLoose, slugsUnder,
         type CategoryRow } from '@/lib/catalogue/tree';
import CollectionGrid from '../../CollectionGrid';
import CollectionSearch from './CollectionSearch';
import GroupCards, { type GroupCard } from '../../GroupCards';
import BasketBar from '../../BasketBar';
import type { CatalogueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * One node of the catalogue tree.
 *
 * A group shows the collections inside it, and a collection shows products —
 * but a group may also hold products filed directly against it, because a
 * description like "Helmet" supports the group and no sub-type. `?all=1` lists
 * everything beneath a group for someone who would rather scroll than drill.
 *
 * A collection with nothing in it is a real page, not a 404: the catalogue
 * shows its full range whether or not every shelf is stocked, so landing here
 * should say so plainly rather than look like a broken link.
 */
export default async function CollectionPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { slug } = await params;
  const { all } = await searchParams;
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: rows }, { data: categories }, { data: client }, { data: settings },
         { data: groupRows }] =
    await Promise.all([
      sb.from('client_catalogue')
        .select(`id, sku, name, brand, price, in_stock, image_url,
               category_slug, category_name, configurator_only`)
        .order('sku').limit(2000),
      sb.from('categories').select('id, slug, name, sort, parent_id').order('sort'),
      sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
      sb.from('settings').select('vat_rate').eq('id', 1).single(),
      sb.from('product_groups')
        .select('slug, name, brand, image_url, categories(slug), product_group_steps(id, product_group_options(id))')
        .eq('active', true).order('sort'),
    ]);

  const products = (rows ?? []) as CatalogueItem[];
  const vatRate = client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20);

  // Everything not yet categorised, which has no row in `categories`.
  if (slug === 'other') {
    const unfiled = products.filter((p) => !p.category_slug && offeredLoose(p));
    if (unfiled.length === 0) notFound();
    return (
      <Shell title="Other" trail={[]} count={unfiled.length}>
        <CollectionSearch products={unfiled} />
        <BasketBar products={products} vatRate={vatRate} />
      </Shell>
    );
  }

  type RawGroup = {
    slug: string; name: string; brand: string | null; image_url: string | null;
    categories: { slug: string } | null;
    product_group_steps: { id: string; product_group_options: { id: string }[] }[];
  };
  const allGroups = ((groupRows ?? []) as unknown as RawGroup[]).map((g) => ({
    slug: g.slug, name: g.name, brand: g.brand, image_url: g.image_url,
    categorySlug: g.categories?.slug ?? null,
    stepCount: g.product_group_steps.length,
    optionCount: g.product_group_steps.reduce((a, s) => a + s.product_group_options.length, 0),
  }));
  const groupsIn = (slugs: Set<string>): GroupCard[] =>
    allGroups.filter((g) => g.categorySlug && slugs.has(g.categorySlug));

  const tree = buildTree((categories ?? []) as CategoryRow[], products,
                         allGroups.map((g) => ({ categorySlug: g.categorySlug })));
  const found = findNode(tree, slug);
  if (!found) notFound();
  const { node, trail } = found;

  const showAll = all === '1' || node.children.length === 0;
  const wanted = new Set(showAll ? slugsUnder(node) : [node.slug]);
  // A collection served by builders lists its builders and nothing else: the
  // loose products in it are fixed-spec versions of the same goods.
  const shown = products.filter(
    (p) => p.category_slug && wanted.has(p.category_slug) && offeredLoose(p));
  // Groups count as things we list here, so "nothing listed yet" must not
  // appear directly underneath a row of them.
  const shownGroups = groupsIn(wanted);

  return (
    <Shell title={node.name} trail={trail} count={node.total}>
      {node.children.length > 0 && !showAll && (
        <>
          <CollectionGrid nodes={node.children} />
          {node.total === 0 && (
            <Card>
              <Empty>
                Nothing listed in {node.name.toLowerCase()} yet — these collections are
                here so you can see what we supply. Ask us what we can get.
              </Empty>
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {node.total > 0 && <Link
              href={`/portal/c/${node.slug}?all=1`}
              className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
            >
              Browse all {node.total} in {node.name}
            </Link>}
            {node.own > 0 && (
              <span className="text-[12px] text-mute">
                {node.own} not in a sub-collection, shown below
              </span>
            )}
          </div>
        </>
      )}

      <GroupCards groups={shownGroups} />

      {shown.length === 0 ? (
        node.children.length === 0 && shownGroups.length === 0 ? (
          <Card>
            <Empty>
              We supply {node.name.toLowerCase()}, but none are listed here yet. Ask us
              what we can get — or{' '}
              <Link href="/portal/catalogue" className="text-flame-text font-semibold">
                browse the rest of the catalogue
              </Link>.
            </Empty>
          </Card>
        ) : null
      ) : (
        <CollectionSearch products={shown} />
      )}

      <BasketBar products={products} vatRate={vatRate} />
    </Shell>
  );
}

function Shell({
  title, trail, count, children,
}: {
  title: string;
  trail: { slug: string; name: string }[];
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <nav className="flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Breadcrumb">
          <Link href="/portal/catalogue" className="text-flame-text font-semibold">Catalogue</Link>
          {trail.map((t) => (
            <span key={t.slug} className="flex items-center gap-1.5">
              <span className="text-line" aria-hidden>/</span>
              <Link href={`/portal/c/${t.slug}`} className="text-flame-text font-semibold">
                {t.name}
              </Link>
            </span>
          ))}
        </nav>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] mt-1.5">{title}</h1>
        <p className="text-[13px] text-mute mt-1 num">
          {count} product{count === 1 ? '' : 's'}
        </p>
      </div>
      {children}
    </div>
  );
}
