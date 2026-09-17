// Which trade account an address belongs to. Every way this goes wrong is
// quiet: a customer who signs in and sees nothing, or — far worse — one who
// signs in and sees somebody else's orders.
const { clientToLink } = await import('../../.test-build/login/matchClient.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}`
    + (ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`));
};
const client = (id, email, over = {}) =>
  ({ id, email, active: true, auth_user_id: null, ...over });
const id = (c) => (c ? c.id : null);

const MDI = client('mdi', 'dave@mikedixonimports.co.uk');

// ── the ordinary case ─────────────────────────────────────────────────────
check('the address on the account', id(clientToLink([MDI], 'dave@mikedixonimports.co.uk')), 'mdi');
check('typed in capitals', id(clientToLink([MDI], 'Dave@MikeDixonImports.co.uk')), 'mdi');
check('with a space pasted on the end', id(clientToLink([MDI], ' dave@mikedixonimports.co.uk ')), 'mdi');
check('held in capitals on our side',
  id(clientToLink([client('mdi', 'Dave@MikeDixonImports.co.uk')], 'dave@mikedixonimports.co.uk')),
  'mdi');

// ── who it must never claim ───────────────────────────────────────────────
// `_` is a wildcard in a LIKE pattern and an email address is full of them.
check('an underscore is a character, not a wildcard',
  id(clientToLink([client('a', 'johnXsmith@x.com')], 'john_smith@x.com')), null);
check('and neither is a percent sign',
  id(clientToLink([client('a', 'anything@x.com')], '%@x.com')), null);

check('an account somebody already signed into',
  id(clientToLink([client('mdi', 'dave@mdi.co.uk', { auth_user_id: 'u1' })], 'dave@mdi.co.uk')),
  null);
check('a suspended account',
  id(clientToLink([client('mdi', 'dave@mdi.co.uk', { active: false })], 'dave@mdi.co.uk')), null);
check('an account with no address on it',
  id(clientToLink([client('mdi', null)], 'dave@mdi.co.uk')), null);
check('an address we do not hold', id(clientToLink([MDI], 'someone@else.com')), null);
check('nothing typed', id(clientToLink([MDI], '')), null);
check('something that is not an address', id(clientToLink([MDI], 'dave')), null);

// Two records on one address is a fault in the data, not a choice to make:
// picking whichever came back first is a coin toss over whose orders they see.
check('two accounts on one address picks neither',
  id(clientToLink([client('a', 'shared@x.com'), client('b', 'shared@x.com')], 'shared@x.com')),
  null);
check('but a claimed duplicate leaves one clear winner',
  id(clientToLink(
    [client('a', 'shared@x.com', { auth_user_id: 'u1' }), client('b', 'shared@x.com')],
    'shared@x.com')),
  'b');
check('and a suspended duplicate does too',
  id(clientToLink(
    [client('a', 'shared@x.com', { active: false }), client('b', 'shared@x.com')],
    'shared@x.com')),
  'b');

// ── the shape the caller passes in ────────────────────────────────────────
check('an empty catalogue of clients', id(clientToLink([], 'dave@mdi.co.uk')), null);
check('a record without the auth_user_id column selected',
  id(clientToLink([{ id: 'mdi', email: 'dave@mdi.co.uk', active: true }], 'dave@mdi.co.uk')),
  'mdi');

process.exit(fail ? 1 : 0);
