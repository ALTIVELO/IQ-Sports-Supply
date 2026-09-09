import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
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

  const { data: profile } = await sb
    .from('profiles').select('role, full_name, email').eq('id', user.id).single();
  if (!profile) return null;

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
