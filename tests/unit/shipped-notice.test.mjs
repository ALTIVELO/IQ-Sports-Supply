// The email a customer gets when their order goes out, and again when the
// tracking changes.
//
// Two things it has to get right, and both are about somebody standing in a
// warehouse wondering where their goods are. An order that left in three
// boxes has three numbers, and a notice quoting one of them has them tracking
// a carton that arrived yesterday while the rest is still in a van. And a
// second email about one order, when a number has been corrected, must not
// read as a second order — "your order has shipped" twice is two orders to
// anybody who is not looking closely.
const { shippedNotice } = await import('../../.test-build/email/templates.js');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${cond ? '' : ` — ${extra}`}`);
};

const LINES = [{ sku: 'BPB05SR25', name: 'Brake pad', qty: 3, unit_price: 5.4 }];
const base = {
  company: 'IQ Sports Supply', orderNumber: 'SO-0087', invoiceNumber: 'IQ-2026-0051',
  lines: LINES, portalUrl: 'https://example.test/portal/shipping',
};
const parcel = (n, carrier = 'DPD') => ({
  carrier, tracking: n, trackingUrl: `https://track.test/${n}`,
});

// ── one parcel ────────────────────────────────────────────────────────────
const one = shippedNotice({ ...base, parcels: [parcel('15501234567890')] });
ok('a single parcel is announced as the order shipping',
  one.subject === 'IQ Sports Supply — order SO-0087 has shipped', one.subject);
ok('with the number', one.body.includes('15501234567890'));
ok('and the link', one.body.includes('https://track.test/15501234567890'));
// Nobody says "Box 1 of 1" about a single box.
ok('and no box numbering where there is one box', !one.body.includes('Box 1'));
ok('nor a parcel count', !one.body.includes('Parcels'));

// ── three parcels ─────────────────────────────────────────────────────────
const three = shippedNotice({
  ...base,
  parcels: [parcel('AAA1'), parcel('AAA2'), parcel('PF9988', 'Parcelforce')],
});
ok('every number is in the email',
  ['AAA1', 'AAA2', 'PF9988'].every((n) => three.body.includes(n)));
ok('every link too',
  ['AAA1', 'AAA2', 'PF9988'].every((n) => three.body.includes(`track.test/${n}`)));
ok('numbered, so a missing box can be named', three.body.includes('Box 2 of 3'));
ok('and the count is said once at the top', three.body.includes('Parcels   3'));
// A second carrier on one order is ordinary — one box by Parcelforce because
// it was too long for the first. Each parcel carries its own.
ok('each parcel carries its own carrier', three.body.includes('Parcelforce'));
ok('and the others keep theirs', three.body.includes('DPD'));
// In the order they were given, which is the order the boxes are numbered in.
ok('listed in order', three.body.indexOf('AAA1') < three.body.indexOf('AAA2'));

// ── a parcel with no link ─────────────────────────────────────────────────
// Some carriers give a number and no URL worth printing. The number still has
// to appear; an empty "Track it" line would read as a broken email.
const noUrl = shippedNotice({
  ...base,
  parcels: [{ carrier: 'Own van', tracking: 'HAND-DELIVERED', trackingUrl: null }],
});
ok('a parcel with no link still shows its number', noUrl.body.includes('HAND-DELIVERED'));
ok('and prints no empty track line', !noUrl.body.includes('Track it'));

// ── the second email ──────────────────────────────────────────────────────
const updated = shippedNotice({
  ...base, updated: true, parcels: [parcel('15509999999999')],
});
ok('an update says so in the subject',
  updated.subject === 'IQ Sports Supply — updated tracking for order SO-0087',
  updated.subject);
ok('and never claims the order has just shipped',
  !updated.subject.includes('has shipped'), updated.subject);
ok('the first line explains why they are getting it again',
  updated.body.startsWith('The tracking for this order has changed'));
ok('and tells them to ignore what came before',
  updated.body.includes('rather than anything we sent earlier'));
ok('with the number that is now right', updated.body.includes('15509999999999'));

// The same order, same lines: an update is not a different order.
ok('it is still about the same order', updated.body.includes('SO-0087'));
ok('and still lists the goods', updated.body.includes('BPB05SR25'));

// Plural reads correctly when several numbers have changed.
const updatedMany = shippedNotice({
  ...base, updated: true, parcels: [parcel('A1'), parcel('A2')],
});
ok('several corrected numbers read as numbers, not a number',
  updatedMany.body.includes('current numbers — please use them'),
  updatedMany.body.split('\n')[0]);
ok('and one reads as one number',
  updated.body.includes('current number — please use it'),
  updated.body.split('\n')[0]);
// One sentence, not one broken over a line by the template literal.
ok('the opening is not hard-wrapped mid-sentence',
  updated.body.split('\n')[0].endsWith('earlier.'), updated.body.split('\n')[0]);

process.exit(fail ? 1 : 0);
