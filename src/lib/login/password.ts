/**
 * Passwords: what we will accept as one, and how to say what went wrong.
 *
 * A password is an addition here, never a replacement. The emailed sign-in
 * link keeps working for everybody, which is what makes "forgotten it" a
 * non-event and means nobody can lock themselves out of a trade account at
 * five to five on a Friday.
 */

/** The shape of a Supabase auth error, without importing the client here. */
export interface AuthLike { message?: string; code?: string; status?: number }

/** Length beats punctuation. Long enough to be worth having, and no riddles. */
export const MIN_LENGTH = 10;

/**
 * The handful that a dictionary attack tries first.
 *
 * Deliberately tiny. A real blocklist belongs in the auth provider, and
 * pretending a list of twelve is one would be worse than useless — this is
 * here to catch the person typing "password123" without thinking, not to
 * stand in for rate limiting and hashing.
 */
const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwertyuiop', 'qwerty123',
  'iloveyou1', '1234567890', '12345678910', 'letmein123', 'welcome123',
  'adminadmin', 'changeme1', 'trustno1234',
]);

/**
 * Checks a new password before it is sent anywhere.
 *
 * Returns the reason it is no good, or null. Every message says what to do
 * rather than what was wrong: "make it a bit longer" beats "invalid".
 */
export function validatePassword(
  password: string, confirmation: string, email = '',
): string | null {
  if (!password) return 'Choose a password.';

  if (password !== password.trim()) {
    return 'That password starts or ends with a space. It would work today and '
         + 'baffle you in a month — take the space off.';
  }
  if (password.length < MIN_LENGTH) {
    return `A bit longer, please — at least ${MIN_LENGTH} characters. `
         + 'Three or four unrelated words beat one clever word.';
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    return 'That is one of the first passwords anybody tries. Pick another.';
  }

  const local = email.trim().toLowerCase().split('@')[0];
  const lower = password.toLowerCase();
  if (email && (lower === email.trim().toLowerCase() || (local.length >= 4 && lower === local))) {
    return 'That is your own email address. Anyone guessing has it already.';
  }

  if (confirmation !== password) return 'The two passwords do not match.';
  return null;
}

/**
 * The alphabet a temporary password is built from.
 *
 * No O/0, no I/l/1: this gets read down a telephone and typed by somebody who
 * has never seen it written, and a customer who cannot tell an l from a 1 is a
 * support call rather than a sign-in.
 */
const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * A password to read out once.
 *
 * Twelve characters in three groups, which is enough entropy for something
 * that only has to survive until its owner changes it, and short enough to say
 * out loud without losing your place. The hyphens are part of it, so it is
 * fifteen characters to type and comfortably over the minimum.
 */
export function temporaryPassword(
  random: (max: number) => number = randomIndex,
): string {
  const pick = () => SAFE[random(SAFE.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}-${group()}`;
}

/** Unbiased, and from the platform's CSPRNG rather than Math.random. */
function randomIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n = 0;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return n % max;
}

/** What went wrong signing in with a password, said usefully. */
export function passwordSignInError(error: AuthLike): string {
  const code = error.code ?? '';
  const raw = error.message ?? '';

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) {
    return 'That email and password do not match an account. If you have not set a '
         + 'password yet, ask for a sign-in link instead and set one from your '
         + 'account page once you are in.';
  }
  if (code === 'email_not_confirmed') {
    return 'This address has not been confirmed yet. Use a sign-in link this once '
         + 'and it will be confirmed as you arrive.';
  }
  if (code === 'over_request_rate_limit' || /rate limit/i.test(raw)) {
    return 'Too many attempts just now. Wait a minute, or ask for a sign-in link.';
  }
  if (code === 'user_banned') {
    return 'This account is suspended. Email us and we will look into it.';
  }
  return raw || 'We could not sign you in. Try a sign-in link instead.';
}

/** What went wrong setting a password, said usefully. */
export function setPasswordError(error: AuthLike): string {
  const code = error.code ?? '';
  const raw = error.message ?? '';

  if (code === 'same_password' || /should be different/i.test(raw)) {
    return 'That is the password you already have.';
  }
  if (code === 'weak_password') {
    return 'That password is too easy to guess. Three or four unrelated words '
         + 'make a better one than a short word with symbols in it.';
  }
  if (code === 'reauthentication_needed') {
    return 'For safety we need a fresh sign-in before the password changes. Sign '
         + 'out, come back in with an emailed link, and set it straight away.';
  }
  if (code === 'session_not_found' || error.status === 401) {
    return 'Your session has expired. Sign in again and set the password from there.';
  }
  if (code === 'over_request_rate_limit' || /rate limit/i.test(raw)) {
    return 'Too many attempts just now. Wait a minute and try again.';
  }
  return raw || 'We could not set that password. Please try again.';
}
