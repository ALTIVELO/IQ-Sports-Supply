'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth';
import { temporaryPassword } from '@/lib/login/password';
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

export interface TemporaryPasswordResult extends ActionResult { password?: string }

/**
 * Gives a client a password to sign in with, once.
 *
 * "Wait for the link" is a poor answer to somebody on the telephone who wants
 * to place an order now, so this hands out a password that gets read out and
 * then insisted upon being changed. It is returned to the screen and never
 * emailed: a password in an inbox outlives the reason it was sent.
 *
 * Where the client has never signed in there is no account yet, so one is made
 * here with the address on file — which is also what makes this work as a way
 * in for a customer who has never been near us before. handle_new_user() links
 * it to their client record by that address, exactly as a first link-sign-in
 * would have.
 */
export async function setTemporaryPassword(
  clientId: string,
): Promise<TemporaryPasswordResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data: client } = await sb.from('clients')
    .select('id, name, email, auth_user_id, active').eq('id', clientId).maybeSingle();
  if (!client) return { ok: false, error: 'No such client' };
  if (!client.active) {
    return { ok: false, error: `${client.name} is not an active account. Reactivate it first.` };
  }
  if (!client.email) {
    return {
      ok: false,
      error: `${client.name} has no email address on file, and a sign-in needs one. `
           + 'Add it above and try again.',
    };
  }

  const password = temporaryPassword();
  const admin = supabaseAdmin();

  let userId = client.auth_user_id as string | null;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false, error: `Could not set the password: ${error.message}` };
  } else {
    // No account yet. Confirmed on creation because a member of staff is
    // vouching for the address out loud, and an unconfirmed account cannot
    // sign in with a password at all.
    const { data, error } = await admin.auth.admin.createUser({
      email: client.email, password, email_confirm: true,
    });
    if (error) return { ok: false, error: `Could not create the sign-in: ${error.message}` };
    userId = data.user.id;
  }

  const { error: flagged } = await admin.from('profiles')
    .update({ must_change_password: true }).eq('id', userId);
  if (flagged) {
    return {
      ok: false,
      error: `The password was set, but marking it temporary failed: ${flagged.message}. `
           + 'Tell them to change it, and try this again.',
    };
  }

  revalidatePath('/staff/clients');
  return { ok: true, password, message: `Temporary password set for ${client.name}` };
}
