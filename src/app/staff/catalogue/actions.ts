'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

export async function saveProduct(input: {
  id?: string; sku: string; name: string; brand: string;
  prices: Record<string, string>; effectiveFrom: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const sku = input.sku.trim();
  const name = input.name.trim();
  if (!sku || !name) return { ok: false, error: 'SKU and product name are both required' };

  let productId = input.id;
  if (productId) {
    const { error } = await sb.from('products')
      .update({ sku, name, brand: input.brand.trim() || null }).eq('id', productId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await sb.from('products')
      .insert({ sku, name, brand: input.brand.trim() || null }).select('id').single();
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

  revalidatePath('/staff/catalogue');
  return { ok: true, message: input.id ? 'Product updated' : 'Product added' };
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
  revalidatePath('/portal');

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
