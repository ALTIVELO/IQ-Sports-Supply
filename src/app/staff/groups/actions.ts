'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

const STAFF = ['admin', 'accounts'] as const;

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const GroupInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Give the group a name').max(200),
  brand: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  category_id: z.string().uuid().nullable().optional(),
});

export async function saveGroup(input: unknown): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const parsed = GroupInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { id, name, brand, description, category_id } = parsed.data;
  const sb = await supabaseServer();
  const row = {
    name,
    brand: brand || null,
    description: description || null,
    category_id: category_id || null,
  };

  // The slug is what the customer's URL says, so it is set once from the
  // opening name and then left alone — renaming a group must not break a link
  // someone has already sent to a customer.
  const { error } = id
    ? await sb.from('product_groups').update(row).eq('id', id)
    : await sb.from('product_groups').insert({ ...row, slug: slugify(name) });

  if (error) {
    return {
      ok: false,
      error: error.code === '23505'
        ? 'A group with a very similar name already exists — give this one a different name.'
        : error.message,
    };
  }

  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: id ? 'Group saved' : `${name} created` };
}

export async function setGroupActive(id: string, active: boolean): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const sb = await supabaseServer();
  const { error } = await sb.from('product_groups').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: active ? 'Group is live' : 'Group hidden from customers' };
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const sb = await supabaseServer();
  // Steps and options cascade. No product is touched: a group is only ever a
  // way of choosing between SKUs that exist in their own right.
  const { error } = await sb.from('product_groups').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: 'Group deleted. No products were affected.' };
}

const StepInput = z.object({
  id: z.string().uuid().optional(),
  group_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name the choice, like "Size" or "Cassette"').max(100),
  hint: z.string().trim().max(200).optional(),
  qty: z.coerce.number().int().min(1, 'At least one').max(99),
  required: z.boolean(),
  sort: z.coerce.number().int().min(0).max(999),
});

export async function saveStep(input: unknown): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const parsed = StepInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { id, ...fields } = parsed.data;
  const row = { ...fields, hint: fields.hint || null };
  const sb = await supabaseServer();
  const { error } = id
    ? await sb.from('product_group_steps').update(row).eq('id', id)
    : await sb.from('product_group_steps').insert(row);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: id ? 'Choice saved' : `"${fields.name}" added` };
}

export async function deleteStep(id: string): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const sb = await supabaseServer();
  const { error } = await sb.from('product_group_steps').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: 'Choice removed' };
}

export async function addOptions(
  stepId: string, productIds: string[], label?: string,
): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  if (!productIds.length) return { ok: false, error: 'No products were chosen' };

  const sb = await supabaseServer();
  const rows = productIds.map((product_id, i) => ({
    step_id: stepId,
    product_id,
    // A label only makes sense for one at a time; adding several keeps each
    // product's own name, which is what the customer would recognise anyway.
    label: productIds.length === 1 ? (label?.trim() || null) : null,
    sort: i,
  }));

  const { error } = await sb.from('product_group_options')
    .upsert(rows, { onConflict: 'step_id,product_id', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return {
    ok: true,
    message: `${productIds.length} option${productIds.length === 1 ? '' : 's'} added`,
  };
}

export async function updateOption(
  id: string, label: string, sort: number,
): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const sb = await supabaseServer();
  const { error } = await sb.from('product_group_options')
    .update({ label: label.trim() || null, sort }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true };
}

export async function deleteOption(id: string): Promise<ActionResult> {
  await requireStaff([...STAFF]);
  const sb = await supabaseServer();
  const { error } = await sb.from('product_group_options').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/groups');
  revalidatePath('/portal');
  return { ok: true, message: 'Option removed' };
}
