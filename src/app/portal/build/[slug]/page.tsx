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

  const [{ data: steps }, { data: options }, { data: client }, { data: settings }] =
    await Promise.all([
      sb.from('product_group_steps')
        .select('id, name, hint, qty, required, sort, axis1_name, axis2_name')
        .eq('group_id', group.id).order('sort'),
      // Priced and stocked for this client by client_catalogue's own RLS, so
      // the figures here are the ones their order would be billed at.
      sb.from('client_group_options')
        .select(`option_id, step_id, product_id, label, sort, sku, price, in_stock,
                 image_url, axis1_value, axis2_value`)
        .eq('group_id', group.id).order('sort'),
      sb.from('clients').select('vat_exempt').eq('id', user.clientId).single(),
      sb.from('settings').select('vat_rate').eq('id', 1).single(),
    ]);

  const withOptions: GroupStep[] = (steps ?? []).map((s) => ({
    ...s,
    options: (options ?? []).filter((o) => o.step_id === s.id),
  }));

  const category = group.categories as unknown as { name: string; slug: string } | null;

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
    />
  );
}
