'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

export async function saveProduct(input: {
  id?: string; sku: string; name: string; brand: string;
  prices: Record<string, string>; cost?: string; effectiveFrom: string;
  /** GBP or EUR. Anything else is refused rather than quietly made sterling. */
  currency?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const sku = input.sku.trim();
  const name = input.name.trim();
  if (!sku || !name) return { ok: false, error: 'SKU and product name are both required' };

  // Undefined means "leave it alone", not "make it sterling": a caller that
  // does not know about currency must never re-denominate a euro product by
  // omission, which would move every price on it by the rate without touching
  // a single figure.
  const currency = input.currency?.trim().toUpperCase() || undefined;
  if (currency && currency !== 'GBP' && currency !== 'EUR') {
    return { ok: false, error: `${input.currency} is not a currency we hold` };
  }

  let productId = input.id;
  let revived = false;

  if (!productId) {
    // A SKU that already exists cannot be inserted again — it is unique, and
    // case-insensitively so. Typing one in usually means the product was
    // withdrawn and is wanted back, and the alternative is a raw duplicate-key
    // error naming a product the screen does not show. So take it as an edit.
    // Escaped: ilike is a pattern match, and `_` is a perfectly ordinary
    // character in a part number. Unescaped, BP_L05 would match BPXL05 too and
    // maybeSingle() would then fail on the second row rather than find the one
    // product meant.
    const pattern = sku.replace(/([\\%_])/g, '\\$1');
    const { data: match } = await sb.from('products')
      .select('id, active').ilike('sku', pattern).maybeSingle();
    if (match) {
      productId = match.id;
      revived = !match.active;
    }
  }

  if (productId) {
    const { error } = await sb.from('products')
      .update({
        sku, name, brand: input.brand.trim() || null,
        ...(currency ? { currency } : {}),
        ...(revived ? { active: true } : {}),
      })
      .eq('id', productId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await sb.from('products')
      .insert({ sku, name, brand: input.brand.trim() || null, currency: currency ?? 'GBP' })
      .select('id').single();
    if (error) return { ok: false, error: error.message };
    productId = data.id;
  }

  // A price change writes a new tier_prices row; history is never overwritten.
  const rows = Object.entries(input.prices)
    .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
    .map(([tier_id, v]) => ({
      product_id: productId!, tier_id, price: Number(v),
      effective_from: input.effectiveFrom,
    }));

  if (rows.length) {
    const { error } = await sb.from('tier_prices')
      .upsert(rows, { onConflict: 'product_id,tier_id,effective_from' });
    if (error) return { ok: false, error: error.message };
  }

  // What we pay is a dated history too, for the same reason: a margin worked
  // out last quarter must not move because the supplier repriced this one.
  const cost = input.cost?.trim();
  if (cost && !Number.isNaN(Number(cost))) {
    const { error } = await sb.from('product_costs').upsert(
      { product_id: productId!, cost: Number(cost), effective_from: input.effectiveFrom },
      { onConflict: 'product_id,effective_from' },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/staff/catalogue');
  revalidatePath('/portal', 'layout');
  return {
    ok: true,
    message: revived
      ? `${sku} was withdrawn and is back on sale, with these prices`
      : input.id ? 'Product updated' : 'Product added',
  };
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.from('products').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/catalogue');
  return { ok: true };
}

/** Points a product at an image, or clears it. The upload itself happens in
 *  the browser; this only records the resulting URL. */
export async function setProductImage(
  productId: string,
  imageUrl: string | null,
): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.from('products').update({ image_url: imageUrl }).eq('id', productId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/catalogue');
  return { ok: true };
}

export interface DeleteResult extends ActionResult { deleted?: number; withdrawn?: string[] }

/**
 * Removes a batch of products from the catalogue.
 *
 * Products that have been sold or moved between sites are withdrawn rather
 * than deleted — an invoice has to keep naming what was on it — so this can
 * come back partly done, and says which SKUs stayed.
 */
export async function deleteProducts(ids: string[]): Promise<DeleteResult> {
  await requireStaff(['admin', 'accounts']);
  if (!ids.length) return { ok: false, error: 'Nothing was selected' };

  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('delete_products', { p_ids: ids });
  if (error) return { ok: false, error: error.message };

  const { deleted = 0, withdrawn = [] } =
    (data ?? {}) as { deleted?: number; withdrawn?: string[] };

  revalidatePath('/staff/catalogue');
  revalidatePath('/portal', 'layout');

  const parts: string[] = [];
  if (deleted) parts.push(`${deleted} product${deleted === 1 ? '' : 's'} deleted`);
  if (withdrawn.length) {
    parts.push(
      `${withdrawn.length} withdrawn instead because ${withdrawn.length === 1 ? 'it appears' : 'they appear'} `
      + `on past orders: ${withdrawn.slice(0, 8).join(', ')}`
      + (withdrawn.length > 8 ? ` and ${withdrawn.length - 8} more` : ''),
    );
  }
  return { ok: true, message: parts.join('. ') || 'Nothing to do', deleted, withdrawn };
}

// ── grouping the sizes that were already in the names ───────────────────────

export interface VariantSuggestion {
  model: string;
  /** Collection and brand are part of the key, so two are shown side by side. */
  sizes: { productId: string; sku: string; name: string; label: string }[];
}

/**
 * What would be grouped, without grouping it.
 *
 * Read-only on purpose. A wrong grouping hides a real product behind another
 * one's name, and the person who finds out is a customer looking for a part
 * that used to be in the list — so somebody looks at this first.
 */
export async function previewVariantGroups(): Promise<
  { ok: true; groups: VariantSuggestion[] } | { ok: false; error: string }
> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data, error } = await sb.rpc('suggest_variant_groups');
  if (error) return { ok: false, error: error.message };

  const byModel = new Map<string, VariantSuggestion>();
  for (const row of (data ?? []) as {
    product_id: string; sku: string; name: string; model: string; label: string;
  }[]) {
    const group = byModel.get(row.model) ?? { model: row.model, sizes: [] };
    group.sizes.push({
      productId: row.product_id, sku: row.sku, name: row.name, label: row.label,
    });
    byModel.set(row.model, group);
  }
  return { ok: true, groups: [...byModel.values()] };
}

/** Writes the grouping. Products already in a group are never touched. */
export async function applyVariantGroups(): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data, error } = await sb.rpc('apply_variant_groups');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/catalogue');
  revalidatePath('/portal/catalogue');

  const n = Number(data ?? 0);
  return {
    ok: true,
    message: n
      ? `${n} product${n === 1 ? '' : 's'} grouped. They now show as one item with `
        + 'sizes under it, here and in the customer catalogue.'
      : 'Nothing left to group — every product whose size is in its name already has one.',
  };
}

/**
 * Takes a product back out of its group.
 *
 * The way back from a wrong grouping. Ungrouping one size of a pair leaves the
 * other on its own, which the catalogue draws as an ordinary product, so there
 * is nothing to clean up afterwards.
 */
export async function ungroupProducts(productIds: string[]): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  if (!productIds.length) return { ok: false, error: 'Nothing selected' };
  const sb = await supabaseServer();

  const { error } = await sb.from('products')
    .update({ variant_group: null, variant_label: null, variant_sort: null })
    .in('id', productIds);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/catalogue');
  revalidatePath('/portal/catalogue');
  return {
    ok: true,
    message: `${productIds.length} product${productIds.length === 1 ? '' : 's'} `
           + 'taken out of their group and listed on their own again',
  };
}
