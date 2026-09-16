'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

const Invite = z.object({
  email: z.string().trim().email('That does not look like an email address').max(200),
  role: z.enum(['admin', 'accounts', 'ops']),
  note: z.string().trim().max(200).optional(),
});

/**
 * Adds a staff member, or changes the role of one already listed.
 *
 * The rules live in invite_staff() rather than here: this screen is not the
 * only way in, and a check that only exists in the page is no check at all.
 */
export async function inviteStaff(formData: FormData): Promise<ActionResult> {
  await requireStaff(['admin']);
  const parsed = Invite.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const sb = await supabaseServer();
  const { error } = await sb.rpc('invite_staff', {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/team');
  revalidatePath('/staff/locations');
  return { ok: true, message: `${parsed.data.email} is now ${label(parsed.data.role)}` };
}

export async function revokeStaff(email: string): Promise<ActionResult> {
  await requireStaff(['admin']);
  const sb = await supabaseServer();
  const { error } = await sb.rpc('revoke_staff', { p_email: email });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/team');
  revalidatePath('/staff/locations');
  return { ok: true, message: `${email} no longer has access` };
}

const label = (r: string) =>
  r === 'admin' ? 'an admin' : r === 'accounts' ? 'accounts' : 'ops';
