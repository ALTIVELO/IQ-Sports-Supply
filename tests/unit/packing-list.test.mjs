// Sending a packing list to whoever is packing it.
//
// The list can go out before the money and before the goods, because the
// people who need it are often not the people who can see the screen: a site
// holding our stock, somebody getting a pick ready for the morning. That is
// the whole point of the feature and also its one risk — a list that arrives
// looking exactly like a list for an order that is ready to go out is how an
// unpaid order gets shipped. So what is held down here is that the email says
// what is outstanding, in the subject as well as the body, where it is read
// before the attachment is opened.
//
// And the address, which is typed rather than picked, because half of them
// are not on this system. Typed means commas, semicolons, a name pasted out
// of a mail client, and the same address twice.
const { packingList } = await import('../../.test-build/email/templates.js');
const { parseRecipients } = await import('../../.test-build/email/recipients.js');
const { holdNotice } = await import('../../.test-build/pdf/documents.js');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${cond ? '' : ` — ${extra}`}`);
};

const base = {
  company: 'IQ Sports Supply', invoiceNumber: 'IQ-2026-021', orderNumber: 'SO-021',
  clientName: 'Velo Barn Cycles Ltd', site: 'Cornwall', lineCount: 3, totalUnits: 11,
};

// ── what it says when nothing is holding it ────────────────────────────────
const ready = packingList({ ...base, hold: null });
ok('a ready list is just a packing list', !/do not dispatch/i.test(ready.subject),
  ready.subject);
ok('and says nothing about payment', !/paid/i.test(ready.body));
ok('it names the invoice', ready.subject.includes('IQ-2026-021'), ready.subject);
ok('and the order', ready.subject.includes('SO-021'), ready.subject);
ok('the client is on it, because it is the note that goes in the box',
  ready.body.includes('Velo Barn Cycles Ltd'));
ok('so is the site it ships from', ready.body.includes('Cornwall'));
ok('and what is on it', /3 lines, 11 units/.test(ready.body), ready.body);
ok('signed off like everything else', ready.body.includes('Company No. 17430665'));

// ── and when something is ──────────────────────────────────────────────────
for (const [hold, saying] of [
  ['payment', /has not been paid/i],
  ['stock', /not all of this order is in stock/i],
  ['both', /has not been paid.*in stock/is],
]) {
  const m = packingList({ ...base, hold });
  ok(`a list held for ${hold} warns in the subject`,
    /do not dispatch yet/i.test(m.subject), m.subject);
  ok(`and says what for`, saying.test(m.body), m.body.slice(0, 120));
  ok(`before anything else, where it is read`,
    m.body.indexOf('attached') > m.body.search(saying), m.body.slice(0, 160));
  ok(`and says the goods stay put`, /should leave the building/i.test(m.body));
}

// A single hold names one thing only: "not paid, and not in stock" on an
// order that is simply unpaid is a second problem somebody goes looking for.
ok('an unpaid list does not also claim to be short',
  !/in stock/i.test(packingList({ ...base, hold: 'payment' }).body));
ok('and a short one does not also claim to be unpaid',
  !/paid/i.test(packingList({ ...base, hold: 'stock' }).body));

// ── going somewhere other than the client ──────────────────────────────────
const direct = packingList({
  ...base, hold: null, shipTo: '14 Mill Lane\nBristol BS1 4QR',
});
ok('a direct delivery says where it is going', direct.body.includes('14 Mill Lane'));
ok('and says that is what it is', /going direct to/i.test(direct.body));
ok('an ordinary one says nothing of the sort', !/going direct to/i.test(ready.body));

// ── the address box ────────────────────────────────────────────────────────
const one = parseRecipients('pack@cornwall.example');
ok('one address reads as one', one.to.length === 1 && one.bad.length === 0,
  JSON.stringify(one));

const many = parseRecipients(' a@x.com, b@y.com;c@z.com\n d@w.com , ');
ok('commas, semicolons and newlines all separate',
  many.to.join(',') === 'a@x.com,b@y.com,c@z.com,d@w.com', JSON.stringify(many.to));
ok('and a trailing comma is not an address', many.bad.length === 0,
  JSON.stringify(many.bad));

const pasted = parseRecipients('James <james@iqsportsupply.com>');
ok('a name pasted out of a mail client is unwrapped',
  pasted.to[0] === 'james@iqsportsupply.com', JSON.stringify(pasted));

const dupe = parseRecipients('Pack@Cornwall.example, pack@cornwall.example');
ok('the same address twice is sent once', dupe.to.length === 1, JSON.stringify(dupe.to));
ok('and keeps the spelling it was first given',
  dupe.to[0] === 'Pack@Cornwall.example', dupe.to[0]);

const wrong = parseRecipients('pack@cornwall.example, not-an-address, @nope.com');
ok('what is not an address is handed back', wrong.bad.length === 2, JSON.stringify(wrong.bad));
ok('as it was typed, so it can be found and fixed',
  wrong.bad.includes('not-an-address'), JSON.stringify(wrong.bad));
ok('and the good one is still read', wrong.to.length === 1, JSON.stringify(wrong.to));

ok('an empty box is no addresses rather than one bad one',
  parseRecipients('   ').to.length === 0 && parseRecipients('   ').bad.length === 0);
ok('and nothing at all does not throw',
  parseRecipients('').to.length === 0);

// ── and on the sheet of paper itself ───────────────────────────────────────
//
// The email warns whoever opens it. The thing that ends up on a bench is the
// PDF, and it is the only one in the pile that must not be acted on, so it
// says why on its face. Named here because the wording is the whole
// safeguard: "do not dispatch" with no reason has somebody go looking for one.
for (const [hold, what] of [
  ['payment', 'Awaiting payment'],
  ['stock', 'Awaiting stock'],
  ['both', 'Awaiting payment and stock'],
]) {
  const band = holdNotice(hold);
  ok(`the band for ${hold} says what is missing`, band.startsWith(what), band);
  ok(`and what not to do about it`, /do not dispatch/.test(band), band);
  ok(`while still asking for the picking`, /pick and check/.test(band), band);
}
ok('the three are not the same sentence',
  new Set(['payment', 'stock', 'both'].map(holdNotice)).size === 3);

if (fail) process.exitCode = 1;
