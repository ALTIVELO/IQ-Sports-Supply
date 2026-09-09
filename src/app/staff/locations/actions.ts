'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';
import type { Role } from '@/lib/types';

export async function saveLocation(input: {
  id?: string; name: string; address: string; active: boolean;
}): Promise<ActionResult> {
  await requireStaff(['admin']);
  const sb = await supabaseServer();

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Location name is required' };
  const row = { name, address: input.address.trim() || null, active: input.active };

  const { error } = input.id
    ? await sb.from('locations').update(row).eq('id', input.id)
    : await sb.from('locations').insert(row);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/locations');
  return { ok: true, message: input.id ? 'Location updated' : 'Location added' };
}

/** Replaces an ops user's site assignments in one go. */
export async function setOpsLocations(profileId: string, locationIds: string[]): Promise<ActionResult> {
  await requireStaff(['admin']);
  const sb = await supabaseServer();

  const { error: delErr } = await sb.from('ops_locations').delete().eq('profile_id', profileId);
  if (delErr) return { ok: false, error: delErr.message };

  if (locationIds.length) {
    const { error } = await sb.from('ops_locations')
      .insert(locationIds.map((location_id) => ({ profile_id: profileId, location_id })));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/staff/locations');
  return { ok: true, message: 'Site assignments saved' };
}

export async function setUserRole(profileId: string, role: Role): Promise<ActionResult> {
  await requireStaff(['admin']);
  const sb = await supabaseServer();
  const { error } = await sb.from('profiles').update({ role }).eq('id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/locations');
  return { ok: true, message: 'Role updated' };
}
