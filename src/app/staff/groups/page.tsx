import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import GroupsScreen, { type Group, type ProductLite } from './GroupsScreen';

export const dynamic = 'force-dynamic';

/**
 * Variants and build-your-own kits.
 *
 * A group never holds a price or a stock figure — it points at SKUs that carry
 * their own — so nothing here can quote a customer a number the catalogue
 * would not honour.
 */
export default async function GroupsPage() {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: groups }, { data: products }, { data: categories }] = await Promise.all([
    sb.from('product_groups')
      .select(`id, slug, name, brand, description, category_id, image_url, active, sort,
               product_group_steps(id, name, hint, qty, required, sort,
                 product_group_options(id, product_id, label, sort))`)
      .order('name'),
    sb.from('products').select('id, sku, name, brand, active').eq('active', true)
      .order('sku').limit(2000),
    sb.from('categories').select('id, name, parent_id, sort').order('sort'),
  ]);

  return (
    <>
      <PageHeading sub="A tyre sold in several sizes, or a groupset a customer specs themselves. Both are the same thing: a list of choices, each pointing at SKUs that already exist. Prices and stock stay with the SKU, so a group can never quote a figure the catalogue would not honour.">
        Variants &amp; builds
      </PageHeading>
      <GroupsScreen
        groups={(groups ?? []) as unknown as Group[]}
        products={(products ?? []) as ProductLite[]}
        categories={categories ?? []}
      />
    </>
  );
}
