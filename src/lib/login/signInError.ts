import type { AuthError } from '@supabase/supabase-js';

export function signInError(error: Pick<AuthError, 'message' | 'code' | 'status'>): string {
  const code = error.code ?? '';
  const raw = error.message ?? '';

  if (code === 'over_email_send_rate_limit' || /rate limit|only request this after/i.test(raw)) {
    return 'Too many sign-in links have been requested for this address just now. '
         + 'Wait a minute and try again — and check your inbox, because an earlier '
         + 'link may already be there and will still work.';
  }

  if (/error sending/i.test(raw) || error.status === 500) {
    return 'We could not send your sign-in link. This is a fault at our end, not '
         + 'with your address. Please email us and we will sort it out.';
  }

  if (code === 'validation_failed' || /invalid.*email/i.test(raw)) {
    return 'That does not look like a valid email address.';
  }

  return raw || 'We could not send your sign-in link. Please try again.';
}