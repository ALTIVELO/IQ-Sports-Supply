// The magic link is sent by Supabase Auth, so its raw errors describe
// Supabase's mail setup rather than anything the person can act on.
const { signInError } = await import('../../.test-build/login/signInError.js');

let fail = 0;
const check = (label, got, wants) => {
  const ok = wants.every((w) => got.toLowerCase().includes(w.toLowerCase()));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${ok ? '' : `\n        got: ${got}`}`);
};

check('the rate limit tells them to wait, and to check their inbox',
  signInError({ message: 'For security purposes, you can only request this after 47 seconds.',
                code: 'over_email_send_rate_limit', status: 429 }),
  ['wait', 'inbox']);

check('a rate limit recognised from the message alone',
  signInError({ message: 'Email rate limit exceeded', status: 429 }),
  ['wait']);

check('a send failure is owned as our fault, not blamed on their address',
  signInError({ message: 'Error sending confirmation email', code: 'unexpected_failure', status: 500 }),
  ['our end', 'not']);

check('any 500 is treated the same way',
  signInError({ message: 'Internal Server Error', status: 500 }),
  ['our end']);

check('a bad address says so plainly',
  signInError({ message: 'Unable to validate email address: invalid format',
                code: 'validation_failed', status: 400 }),
  ['valid email address']);

check('anything unrecognised is passed through rather than swallowed',
  signInError({ message: 'Signups not allowed for otp', code: 'otp_disabled', status: 422 }),
  ['Signups not allowed for otp']);

check('and an error with no message at all still says something',
  signInError({ message: '', status: 0 }),
  ['could not send']);

console.log(fail ? `\n${fail} failed` : '');
process.exit(fail ? 1 : 0);
