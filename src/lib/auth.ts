import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import type { Role } from './types';
import { clientToLink } from './login/matchClient';

export interface SessionUser {
  id: string;
  email: string | null;
  role: Role;
  fullName: string | null;
  /** Set for client users only. */
  clientId: string | null;
  /** Fulfilment sites an ops user is assigned to; admin/accounts see all. */
  locationIds: string[];
  /** Signed in on a temporary password, and going nowhere until it changes. */
  mustChangePassword: boolean;
}

const STAFF: Role[] = ['admin', 'accounts', 'ops'];

/** The signed-in user with their role and scope, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  let { data: profile } = await sb
    .from('profiles').select('role, full_name, email, must_change_password')
    .eq('id', user.id).maybeSingle();

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

  const [{ data: found }, { data: opsLocs }] = await Promise.all([
    sb.from('clients').select('id').eq('auth_user_id', user.id).maybeSingle(),
    sb.from('ops_locations').select('location_id').eq('profile_id', user.id),
  ]);

  // handle_new_user() attaches a client record to its user at signup. That
  // fires once, and only if the record already existed carrying a matching
  // address — so an account approved afterwards, an address corrected since,
  // or a hosted setup that would not take the trigger all leave an approved
  // customer signed in with nothing to see and no way out of /pending.
  //
  // So the link is repaired here, on every sign-in, rather than at one moment
  // nobody can go back to. It only ever claims a record with no user yet.
  const address = profile.email ?? user.email ?? null;
  const client = found
    ?? (role === 'client' && address ? await linkClientByEmail(user.id, address) : null);

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
    mustChangePassword: Boolean(profile.must_change_password),
  };
}

/**
 * Where a temporary password sends you, and nowhere else.
 *
 * Both guards call this before anything else they check. A password somebody
 * else chose and read out loud should survive exactly one sign-in, so every
 * guarded screen is a closed door until it is replaced.
 */
function requirePasswordChanged(user: SessionUser) {
  if (user.mustChangePassword) redirect('/password');
}

/** Guard for the staff app. */
export async function requireStaff(roles: Role[] = STAFF): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  requirePasswordChanged(user);
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
  requirePasswordChanged(user);
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
): Promise<{
  role: string; full_name: string | null; email: string | null;
  must_change_password: boolean;
} | null> {
  try {
    const admin = supabaseAdmin();

    // Read it as the service role first. An earlier version went straight to
    // an upsert with role 'client', which would quietly demote an existing
    // admin any time their own RLS read came back empty.
    const { data: existing } = await admin
      .from('profiles').select('role, full_name, email, must_change_password')
      .eq('id', userId).maybeSingle();
    if (existing) return existing;

    // An allowlisted address is staff from its first sign-in. This mirrors
    // handle_new_user(); it is repeated here because some hosted setups will
    // not let that trigger be installed on auth.users at all.
    const role = (email && await invitedRole(admin, email)) || 'client';

    const { data: created } = await admin
      .from('profiles')
      .upsert({ id: userId, email, role }, { onConflict: 'id' })
      .select('role, full_name, email, must_change_password')
      .single();

    return created ?? null;
  } catch {
    // No service-role key configured, or the insert was refused.
    return null;
  }
}

/**
 * Attaches the approved client record carrying this address, if there is one.
 *
 * Which record that is, and whether there is one at all, is clientToLink's
 * decision — the same one the sign-in preparation makes. Needs the service
 * role: RLS quite rightly does not let a customer attach themselves to a trade
 * account.
 */
export async function linkClientByEmail(
  userId: string, email: string,
): Promise<{ id: string } | null> {
  try {
    const admin = supabaseAdmin();
    const { data: candidates } = await admin
      .from('clients').select('id, email, active').is('auth_user_id', null);

    const target = clientToLink(candidates ?? [], email);
    if (!target) return null;

    const { error } = await admin
      .from('clients').update({ auth_user_id: userId }).eq('id', target.id);
    return error ? null : { id: target.id };
  } catch {
    // No service-role key configured. The customer lands on /pending, which
    // now says what happened rather than telling them to apply again.
    return null;
  }
}

/**
 * The role an address has been allowlisted for in `staff_invites`, or null.
 *
 * Compared exactly and case-insensitively, never with ilike: `_` and `%` are
 * wildcards there, and an email is full of underscores, so a lookup by pattern
 * would let one address match an invitation issued to another.
 */
async function invitedRole(
  admin: ReturnType<typeof supabaseAdmin>,
  email: string,
): Promise<Role | null> {
  const { data } = await admin
    .from('staff_invites').select('email, role');
  const wanted = email.trim().toLowerCase();
  const hit = (data ?? []).find((r) => r.email?.trim().toLowerCase() === wanted);
  return (hit?.role as Role) ?? null;
}
