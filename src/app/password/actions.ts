'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validatePassword } from '@/lib/login/password';
import type { ActionResult } from '../staff/actions';

/**
 * Replaces a temporary password with one its owner chose.
 *
 * Both halves happen here, with the service role, because they are one thing:
 * a flag cleared without a password changed leaves the temporary one live, and
 * a password changed without the flag cleared locks somebody out of their own
 * account. Doing it in the browser would let a client call the second without
 * the first.
 */
export async function replaceTemporaryPassword(
  password: string, confirmation: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const complaint = validatePassword(password, confirmation, user.email ?? '');
  if (complaint) return { ok: false, error: complaint };

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) return { ok: false, error: `Could not set that password: ${error.message}` };

  const { error: cleared } = await admin.from('profiles')
    .update({ must_change_password: false }).eq('id', user.id);
  if (cleared) {
    return {
      ok: false,
      error: 'Your password changed, but we could not record it. Sign in with the new '
           + 'one and tell us if you are asked to change it again.',
    };
  }

  revalidatePath('/', 'layout');
  return { ok: true, message: 'Password set' };
}
