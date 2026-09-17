// What we will accept as a password, and what we say when something is wrong.
// The messages matter as much as the rules: somebody locked out of a trade
// account on a Friday afternoon needs to be told what to do next, not what
// was invalid.
const { validatePassword, passwordSignInError, setPasswordError, MIN_LENGTH,
        temporaryPassword } = await import('../../.test-build/login/password.js');

let fail = 0;
const ok = (label, got) => {
  const good = got === null;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        got: ${got}`}`);
};
const rejects = (label, got, wants) => {
  const good = got !== null && wants.every((w) => got.toLowerCase().includes(w.toLowerCase()));
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        got: ${got}`}`);
};

// ── what we accept ────────────────────────────────────────────────────────
ok('four unrelated words',
  validatePassword('correct horse battery staple', 'correct horse battery staple'));
ok('exactly the minimum length', validatePassword('a'.repeat(MIN_LENGTH), 'a'.repeat(MIN_LENGTH)));
ok('a password containing spaces in the middle',
  validatePassword('slough to cornwall', 'slough to cornwall'));
ok('no email given, so nothing to compare against',
  validatePassword('thisislongenough', 'thisislongenough'));

// ── what we refuse ────────────────────────────────────────────────────────
rejects('nothing typed at all', validatePassword('', ''), ['choose a password']);
rejects('too short', validatePassword('short1', 'short1'), ['longer', String(MIN_LENGTH)]);
rejects('one under the minimum',
  validatePassword('a'.repeat(MIN_LENGTH - 1), 'a'.repeat(MIN_LENGTH - 1)), ['longer']);
rejects('the two entries differ',
  validatePassword('correct horse battery', 'correct horse bettery'), ['do not match']);

// A trailing space works on the day and baffles the person a month later.
rejects('a trailing space', validatePassword('longenoughpw ', 'longenoughpw '), ['space']);
rejects('a leading space', validatePassword(' longenoughpw', ' longenoughpw'), ['space']);

rejects('the first thing anybody tries',
  validatePassword('password123', 'password123'), ['anybody tries']);
rejects('whatever case they type it in',
  validatePassword('PassWord123', 'PassWord123'), ['anybody tries']);

rejects('their own email address',
  validatePassword('dave@mikedixon.co.uk', 'dave@mikedixon.co.uk', 'dave@mikedixon.co.uk'),
  ['email address']);
rejects('or just the name in front of the @',
  validatePassword('davedixonimports', 'davedixonimports', 'davedixonimports@mdi.co.uk'),
  ['email address']);
ok('but a short local part is not a rule worth enforcing',
  validatePassword('joe1234567890', 'joe1234567890', 'joe@mdi.co.uk'));

// The length check runs before the match check: being told the two do not
// match, and then that it is too short, is two trips for one mistake.
rejects('a short password reports its length, not the mismatch',
  validatePassword('short', 'different'), ['longer']);

// ── signing in ────────────────────────────────────────────────────────────
rejects('a wrong password points at the sign-in link',
  passwordSignInError({ code: 'invalid_credentials' }), ['sign-in link', 'account page']);
rejects('and so does the raw message Supabase sends',
  passwordSignInError({ message: 'Invalid login credentials' }), ['sign-in link']);
rejects('an unconfirmed address is a one-link problem',
  passwordSignInError({ code: 'email_not_confirmed' }), ['confirmed', 'sign-in link']);
rejects('too many attempts offers the other way in',
  passwordSignInError({ code: 'over_request_rate_limit' }), ['wait', 'sign-in link']);
rejects('a suspended account says to email us',
  passwordSignInError({ code: 'user_banned' }), ['suspended']);
rejects('anything else falls back to what was said',
  passwordSignInError({ message: 'Network unreachable' }), ['network unreachable']);
rejects('and to something useful when nothing was',
  passwordSignInError({}), ['sign-in link']);

// ── setting one ───────────────────────────────────────────────────────────
rejects('the same password again', setPasswordError({ code: 'same_password' }), ['already have']);
rejects('one the provider thinks is weak',
  setPasswordError({ code: 'weak_password' }), ['guess', 'words']);
rejects('a provider asking for a fresh sign-in says how',
  setPasswordError({ code: 'reauthentication_needed' }), ['sign out', 'link']);
rejects('an expired session', setPasswordError({ status: 401 }), ['expired']);
rejects('and the fallback still says what to do',
  setPasswordError({}), ['try again']);

// ── the one staff read out ────────────────────────────────────────────────
// It gets said down a telephone and typed by somebody who has never seen it
// written, so the characters that look like each other are not in it.
{
  const sample = Array.from({ length: 400 }, () => temporaryPassword());
  const shape = sample.every((p) => /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(p));
  const ambiguous = sample.some((p) => /[O0Il1]/.test(p));
  const accepted = sample.every((p) => validatePassword(p, p) === null);
  const distinct = new Set(sample).size === sample.length;

  for (const [label, good] of [
    ['three groups of four, hyphenated', shape],
    ['nothing that looks like something else', !ambiguous],
    ['long enough to pass our own rules', accepted],
    ['and a different one every time', distinct],
  ]) {
    if (!good) fail++;
    console.log(`${good ? 'PASS ' : 'FAIL '} ${label}`);
  }
}

// Every position is filled from the alphabet, not just the first — a generator
// that reused one draw would still pass the shape check above.
{
  let i = 0;
  const counted = temporaryPassword(() => (i++) % 53);
  const unique = new Set(counted.replace(/-/g, '')).size;
  const good = unique === 12;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} every character is drawn separately`
    + (good ? '' : `  (got ${counted})`));
}

process.exit(fail ? 1 : 0);
