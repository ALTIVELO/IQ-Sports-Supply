import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import type { Role } from './types';

export interface SessionUser {
  id: string;
  email: string | null;
  role: Role;
  fullName: string | null;
  /** Set for client users only. */
  clientId: string | null;
  /** Fulfilment sites an ops user is assigned to; admin/accounts see all. */
  locationIds: string[];
}

const STAFF: Role[] = ['admin', 'accounts', 'ops'];

/** The signed-in user with their role and scope, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  let { data: profile } = await sb
    .from('profiles').select('role, full_name, email').eq('id', user.id).maybeSingle();

  // Normally handle_new_user() creates this row on signup. Some hosted setups
  // will not let that trigger be installed on auth.users, and without a profile
  // a signed-in user has no role and so no access at all — so make the row here
  // instead. Same effect as the trigger: client role, and link an approved
  // client record carrying this email address.
  if (!profile) {
    profile = await ensureProfile(user.id, user.email ?? null);
    if (!profile) return null;
  }

  const role = profile.role as Role;

  const [{ data: client }, { data: opsLocs }] = await Promise.all([
    sb.from('clients').select('id').eq('auth_user_id', user.id).maybeSingle(),
    sb.from('ops_locations').select('location_id').eq('profile_id', user.id),
  ]);

  let locationIds: string[] = (opsLocs ?? []).map((r) => r.location_id);
  if (role === 'admin' || role === 'accounts') {
    const { data: all } = await sb.from('locations').select('id');
    locationIds = (all ?? []).map((r) => r.id);
  }

  return {
    id: user.id,
    email: profile.email ?? user.email ?? null,
    role,
    fullName: profile.full_name,
    clientId: client?.id ?? null,
    locationIds,
  };
}

/** Guard for the staff app. */
export async function requireStaff(roles: Role[] = STAFF): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) redirect(user.role === 'client' ? '/portal' : '/login');
  return user;
}

/**
 * Guard for the client portal. A signed-in user with no approved client record
 * has no access to anything — approval is the only path in.
 */
export async function requireClient(): Promise<SessionUser & { clientId: string }> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.clientId) redirect('/pending');
  return user as SessionUser & { clientId: string };
}

export const isStaff = (role: Role) => STAFF.includes(role);

/**
 * Creates the missing profile row for a signed-in user, using the service role
 * because RLS quite rightly does not let a user insert their own profile.
 * Returns null if that is not possible, in which case the user has no access —
 * which is the correct outcome for an unrecognised account.
 */
async function ensureProfile(
  userId: string,
  email: string | null,
): Promise<{ role: string; full_name: string | null; email: string | null } | null> {
  try {
    const admin = supabaseAdmin();

    const { data: created } = await admin
      .from('profiles')
      .upsert({ id: userId, email, role: 'client' }, { onConflict: 'id' })
      .select('role, full_name, email')
      .single();

    if (email) {
      // Matched exactly, case-insensitively — not with ilike, whose _ and %
      // wildcards would let john_smith@x.com claim johnXsmith@x.com's account.
      // And only ever claims a record that has no user yet, so it cannot take
      // over a client who has already signed in.
      const { data: candidates } = await admin
        .from('clients')
        .select('id, email')
        .is('auth_user_id', null);

      const target = (candidates ?? []).find(
        (c) => c.email?.trim().toLowerCase() === email.trim().toLowerCase(),
      );
      if (target) {
        await admin.from('clients').update({ auth_user_id: userId }).eq('id', target.id);
      }
    }

    return created ?? null;
  } catch {
    // No service-role key configured, or the insert was refused.
    return null;
  }
}
