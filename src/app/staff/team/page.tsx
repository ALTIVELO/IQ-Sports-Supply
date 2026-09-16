import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import TeamScreen, { type Member } from './TeamScreen';

export const dynamic = 'force-dynamic';

/**
 * Who works here, and what they can reach. Admin only — this screen hands out
 * roles, so an ops or accounts user must not even be able to read it.
 */
export default async function TeamPage() {
  const user = await requireStaff(['admin']);
  const sb = await supabaseServer();

  const [{ data: invites }, { data: profiles }, { data: opsLocs }, { data: locations }] =
    await Promise.all([
      sb.from('staff_invites').select('email, role, note, created_at').order('email'),
      sb.from('profiles').select('id, email, full_name, role').order('email'),
      sb.from('ops_locations').select('profile_id, location_id'),
      sb.from('locations').select('id, name'),
    ]);

  const siteNames = new Map((locations ?? []).map((l) => [l.id, l.name]));
  const sitesFor = (profileId: string | null) =>
    profileId
      ? (opsLocs ?? []).filter((o) => o.profile_id === profileId)
          .map((o) => siteNames.get(o.location_id) ?? '').filter(Boolean)
      : [];

  // Someone may be in either list: invited but not yet signed in, or given a
  // role directly in the database before this screen existed. Both are staff
  // and both need to be manageable here.
  const byEmail = new Map<string, Member>();

  for (const i of invites ?? []) {
    byEmail.set(i.email, {
      email: i.email, role: i.role, note: i.note,
      profileId: null, fullName: null, signedIn: false, sites: [], invited: true,
    });
  }

  for (const p of profiles ?? []) {
    const email = p.email?.trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      // Signed in. The profile's role is the one actually in force.
      existing.profileId = p.id;
      existing.fullName = p.full_name;
      existing.signedIn = true;
      existing.role = p.role;
      existing.sites = sitesFor(p.id);
    } else if (p.role !== 'client') {
      byEmail.set(email, {
        email, role: p.role, note: null,
        profileId: p.id, fullName: p.full_name, signedIn: true,
        sites: sitesFor(p.id), invited: false,
      });
    }
  }

  const members = [...byEmail.values()].sort(
    (a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email),
  );

  return (
    <>
      <PageHeading sub="Everyone who can reach the staff app. Adding someone lets them sign in with a link to that address — there is no password to set or send.">
        Team
      </PageHeading>
      <TeamScreen members={members} myEmail={user.email?.toLowerCase() ?? ''} />
    </>
  );
}
