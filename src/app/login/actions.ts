'use server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { linkClientByEmail } from '@/lib/auth';
import { clientToLink } from '@/lib/login/matchClient';

/**
 * Makes sure there is an account for an address we already know, before a
 * sign-in link is asked for.
 *
 * A trade account is created by us, not by the person using it: staff approve
 * an application, or type a client in. Until that person signs in for the very
 * first time there is no auth account behind their record — and a magic link
 * for an address with no account only works if the project happens to allow
 * signups, which a trade portal generally should not. So an approved customer
 * who had never got round to logging in simply could not, and the error said
 * nothing useful.
 *
 * This creates the account first, for an address that is already an active
 * client or an allowlisted staff member and nothing else. It is confirmed on
 * creation because we are the ones who put the address there.
 *
 * It answers the same way whatever it finds. Telling an anonymous caller which
 * addresses we hold would be a list of our customers, handed out one guess at
 * a time.
 */
export async function prepareSignIn(email: string): Promise<void> {
  const wanted = email.trim().toLowerCase();
  if (!wanted.includes('@')) return;

  try {
    const admin = supabaseAdmin();

    const [{ data: clients }, { data: invites }] = await Promise.all([
      admin.from('clients').select('id, email, active, auth_user_id'),
      admin.from('staff_invites').select('email'),
    ]);

    const client = clientToLink(clients ?? [], wanted);
    const invited = (invites ?? []).some((i) => i.email?.trim().toLowerCase() === wanted);
    if (!client && !invited) return;

    // Already registered comes back as an error, which is the answer we
    // wanted: there is an account, so the link will work as it is.
    const { data, error } = await admin.auth.admin.createUser({
      email: wanted, email_confirm: true,
    });
    if (error || !data.user) return;

    // handle_new_user() would normally do this on the insert. Doing it here
    // too costs nothing and covers the setups where that trigger could not be
    // installed on auth.users at all.
    if (client) await linkClientByEmail(data.user.id, wanted);
  } catch {
    // No service-role key, or Supabase unreachable. The link request that
    // follows is unaffected — it simply behaves as it did before.
  }
}
