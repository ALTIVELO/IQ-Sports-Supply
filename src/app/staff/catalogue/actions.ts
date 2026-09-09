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
