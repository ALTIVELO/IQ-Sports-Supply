'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

const ClientInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Client name is required'),
  tier_id: z.string().uuid('Pick a pricing tier'),
  email: z.string().trim().email('A valid email is required').or(z.literal('')),
  phone: z.string().trim().optional(),
  vat_no: z.string().trim().optional(),
  address: z.string().trim().optional(),
  vat_exempt: z.boolean(),
  default_location_id: z.string().uuid().nullable(),
});

export async function saveClient(input: unknown): Promise<ActionResult> {
  await requireStaff();
  const parsed = ClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const sb = await supabaseServer();
  const { id, ...fields } = parsed.data;
  const row = { ...fields, email: fields.email || null };

  const { error } = id
    ? await sb.from('clients').update(row).eq('id', id)
    : await sb.from('clients').insert(row);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/clients');
  return { ok: true, message: id ? 'Client updated' : 'Client added' };
}

export async function setClientActive(id: string, active: boolean): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();
  const { error } = await sb.from('clients').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/clients');
  return { ok: true };
}
