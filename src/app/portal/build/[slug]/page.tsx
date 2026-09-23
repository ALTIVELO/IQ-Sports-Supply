import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import GroupBuilder, { type GroupStep } from './GroupBuilder';

export const dynamic = 'force-dynamic';

/**
 * One product group: a tyre in five sizes, or a groupset to spec.
 *
 * Both are the same page. A group with one step reads as a size picker and a
 * group with several reads as a builder, because that is the only difference
 * between them.
 */
export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: group } = await sb
    .from('product_groups')
    .select('id, slug, name, brand, description, image_url, active, categories(name, slug)')
    .eq('slug', slug).eq('active', true).maybeSingle();
  if (!group) notFound();

  const [{ data: steps }, { data: options }, { data: client }, { data: settings },
         { data: siblings }] =
    await Promise.all([
      sb.from('product_group_steps')
        .select('id, name, hint, qty, required, sort, axis1_name, axis2_name')
        .eq('group_id', group.id).order('sort'),
      // Priced and stocked for this client by client_catalogue's own RLS, so
      // the figures here are the ones their order would be billed at.
      sb.from('client_group_options')
        .select(`option_id, step_id, product_id, label, sort, sku, price, currency, in_stock,
                 image_url, axis1_value, axis2_value`)
        .eq('group_id', group.id).order('sort'),
      sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
      sb.from('settings').select('vat_rate').eq('id', 1).single(),
      /*
       * The other builds, for the foot of this one.
       *
       * Somebody on the Dura-Ace page is a click away from the Ultegra and
       * has no way of knowing it: a builder is reached from a collection
       * card, and once you are inside one the only way back to its siblings
       * is the browser's back button. The power-meter variants are the case
       * that makes it obvious — they are the same groupset with one part
       * changed, listed separately, and invisible from each other.
       */
      sb.from('product_groups')
        .select('slug, name, brand, image_url, sort, categories(slug), '
              + 'product_group_steps(id, product_group_options(id))')
        .eq('active', true).neq('slug', slug).order('sort'),
    ]);

  const withOptions: GroupStep[] = (steps ?? []).map((s) => ({
    ...s,
    options: (options ?? []).filter((o) => o.step_id === s.id),
  }));

  const category = group.categories as unknown as { name: string; slug: string } | null;

  type RawGroup = {
    slug: string; name: string; brand: string | null; image_url: string | null;
    categories: { slug: string } | null;
    product_group_steps: { id: string; product_group_options: { id: string }[] }[];
  };
  /*
   * Its own collection first, then the rest.
   *
   * A groupset page shows the other groupsets before it shows a wheel
   * builder: the nearest alternative to what somebody is already specifying
   * is another of the same kind. Everything else still follows, because a
   * builder is the one page with no list on it and a dead end is worse than
   * a slightly long one.
   */
  const others = ((siblings ?? []) as unknown as RawGroup[]).map((g) => ({
    slug: g.slug, name: g.name, brand: g.brand, image_url: g.image_url,
    sameCollection: (g.categories?.slug ?? null) === (category?.slug ?? null),
    stepCount: g.product_group_steps.length,
    optionCount: g.product_group_steps.reduce((a, st) => a + st.product_group_options.length, 0),
  }));
  const ordered = [...others.filter((g) => g.sameCollection),
                   ...others.filter((g) => !g.sameCollection)];

  return (
    <GroupBuilder
      name={group.name}
      brand={group.brand}
      description={group.description}
      imageUrl={group.image_url}
      categoryName={category?.name ?? null}
      categorySlug={category?.slug ?? null}
      steps={withOptions}
      vatRate={client?.vat_exempt ? 0 : Number(settings?.vat_rate ?? 20)}
      others={ordered}
      othersHeading={category?.name ?? null}
    />
  );
}
