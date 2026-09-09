import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS, so it is only for work that has no signed-in
 * user: public trade-account applications, and the Xero payment-status poll.
 * Never import this into a component.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
