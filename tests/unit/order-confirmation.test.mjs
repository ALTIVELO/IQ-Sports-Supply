// The email a customer gets when they place an order.
//
// There are two of them, because an introduced order is a different email
// with the same lines on it. Everything after the goods is wrong for one of
// them: on a DRAG order we are not collecting the money, not dispatching,
// and the total does not include the shipping and taxes DRAG will add. One
// paragraph covering both would have to be vague about all of it.
const { orderConfirmation } = await import('../../.test-build/email/templates.js');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${cond ? '' : ` — ${extra}`}`);
};

const LINES = [
  { sku: 'DRG-OMEGA-56', name: 'DRAG Omega Comp 56cm', qty: 1, unit_price: 1450 },
  { sku: 'DRG-OMEGA-54', name: 'DRAG Omega Comp 54cm', qty: 2, unit_price: 1450 },
];
const base = {
  company: 'IQ Sports Supply', clientName: 'Pedal Revolution Ltd',
  orderNumber: 'SO-0087', invoiceNumber: 'IQ-2026-0051',
  date: '2026-09-18', dueDate: '2026-10-18', vatRate: 20,
  lines: LINES, backordered: [], portalUrl: 'https://example.test/portal/orders',
};
const TERMS = [
  '{brand} raises the final invoice, which includes shipping and any duty or taxes.',
  '{company} is paid a commission by {brand}. We are not the seller of these goods.',
  '{brand} is responsible for shipping, for warranty, and for product liability.',
].join('\n');

// ── an order we sold ──────────────────────────────────────────────────────
const own = orderConfirmation({ ...base, currency: 'GBP' });
ok('an ordinary order is confirmed as an invoice',
   /invoice IQ-2026-0051/.test(own.subject), own.subject);
ok('with a due date', own.body.includes('Due'));
ok('and VAT on it', own.body.includes('VAT (20%)'));
ok('and says we are dispatching it', own.body.includes('dispatched once payment'));

// ── an order we introduced ────────────────────────────────────────────────
const agency = orderConfirmation({
  ...base, currency: 'EUR', agencyTerms: TERMS, agentBrand: 'DRAG',
});

// The subject line is what most people read. It has to say where the order
// has gone before they open anything.
ok('the subject says the order has gone to the brand',
   agency.subject === 'IQ Sports Supply — order SO-0087 received, going to DRAG',
   agency.subject);
ok('and does not call it an invoice', !/invoice/i.test(agency.subject), agency.subject);

ok('the brand is named in the terms', agency.body.includes('DRAG raises the final invoice'));
ok('and we are named as the one paid a commission',
   agency.body.includes('IQ Sports Supply is paid a commission by DRAG'));
ok('no token is left unfilled', !/\{(brand|company)\}/.test(agency.body), agency.body);

ok('it says who carries the warranty and the liability',
   agency.body.includes('responsible for shipping, for warranty, and for product liability'));

// The three things that would make it read as our invoice.
ok('there is no payment due date on it', !agency.body.includes('Due'), agency.body);
ok('no VAT line, because the tax is theirs to add', !agency.body.includes('VAT ('));
ok('and nothing about us dispatching it', !agency.body.includes('dispatched once payment'));
ok('it says plainly that nothing is owed to us',
   agency.body.includes('Nothing is due to us'));

// The figure we can state, and only that one.
ok('the goods total is the only figure', agency.body.includes('Goods'));
ok('and it says what is not in it',
   agency.body.includes('before shipping and taxes, which DRAG add on their invoice'));
ok('the lines are still listed', agency.body.includes('DRG-OMEGA-56'));
ok('and the portal link is still there', agency.body.includes(base.portalUrl));

// A brand with terms but no name should still read as a sentence, never as
// a gap where a company should be.
const unnamed = orderConfirmation({
  ...base, currency: 'EUR', agencyTerms: '{brand} invoices you.', agentBrand: null,
});
ok('a missing brand name never leaves a blank',
   unnamed.body.includes('the brand invoices you.'), unnamed.body);

process.exit(fail ? 1 : 0);
