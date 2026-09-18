// What a customer is told on an order we introduced rather than sold.
//
// The wording lives on the brand and is snapshotted onto the order, so this
// file is about the one step between the stored text and the page: filling in
// who is who, and splitting it into the statements it is made of. Every
// surface — basket, confirmation, portal, email, PDF — runs the same step, so
// a bug here is a bug on the legal disclosure everywhere at once.
const { agencyLines, agencyHeading } =
  await import('../../.test-build/orders/agency.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const NAMES = { brand: 'DRAG', company: 'IQ Sports Supply' };

// ── the substitutions ─────────────────────────────────────────────────────
eq('the brand is named',
   agencyLines('{brand} raises the final invoice.', NAMES),
   ['DRAG raises the final invoice.']);

// The company name is filled in rather than stored, so renaming it in
// Settings does not leave old documents carrying the old name.
eq('so are we',
   agencyLines('{company} is paid a commission.', NAMES),
   ['IQ Sports Supply is paid a commission.']);

eq('every mention, not just the first',
   agencyLines('{brand} ships and {brand} warrants it.', NAMES),
   ['DRAG ships and DRAG warrants it.']);

eq('both tokens on one line',
   agencyLines('{company} introduces; {brand} sells.', NAMES),
   ['IQ Sports Supply introduces; DRAG sells.']);

// ── the shape ─────────────────────────────────────────────────────────────
eq('one statement per line',
   agencyLines('First.\nSecond.\nThird.', NAMES),
   ['First.', 'Second.', 'Third.']);

eq('blank lines between statements are not statements',
   agencyLines('First.\n\n\nSecond.', NAMES), ['First.', 'Second.']);

eq('leading and trailing space is trimmed',
   agencyLines('   Padded.   \n  Also.  ', NAMES), ['Padded.', 'Also.']);

// ── nothing to say ────────────────────────────────────────────────────────
// An ordinary order has no terms at all, and every surface asks this same
// question before it draws a box. Silence has to mean silence.
eq('no terms is nothing to print', agencyLines(null, NAMES), []);
eq('undefined terms is nothing to print', agencyLines(undefined, NAMES), []);
eq('empty terms is nothing to print', agencyLines('', NAMES), []);
eq('whitespace-only terms is nothing to print', agencyLines('  \n  \n', NAMES), []);

// ── the heading ───────────────────────────────────────────────────────────
eq('says who sells and who arranged it',
   agencyHeading(NAMES), 'Sold by DRAG · arranged by IQ Sports Supply');

process.exit(fail ? 1 : 0);
