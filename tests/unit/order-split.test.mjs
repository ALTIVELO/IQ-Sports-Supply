// Turning one basket into the orders it will actually become.
//
// Two things force a split. An order and its invoice each ask for one
// currency, so a basket holding two is two orders. And an invoice comes from
// one seller: on an agency brand's goods we are the introducer, that brand
// invoices the customer, and those lines cannot sit on a document that also
// demands money for goods we sold.
//
// The figures matter as much as the grouping: the customer is about to be
// shown a total per invoice, and a screen that adds euros to pounds shows a
// number nobody is billed.
const { splitOrders, totalsByCurrency, orderCurrencies } =
  await import('../../.test-build/orders/split.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const CATALOGUE = {
  eur1: { currency: 'EUR' },
  eur2: { currency: 'EUR' },
  gbp1: { currency: 'GBP' },
  gbp2: { currency: 'GBP' },
  // Introduced rather than sold: DRAG invoice the customer themselves.
  drag1: { currency: 'EUR', agentBrand: 'drag' },
  drag2: { currency: 'EUR', agentBrand: 'drag' },
  // A second agency brand, and one that happens to quote in sterling.
  acme1: { currency: 'GBP', agentBrand: 'acme' },
};
const lookup = (id) => CATALOGUE[id];
const line = (product_id, qty = 1) => ({ product_id, qty });
const shape = (parts) =>
  parts.map((p) => [p.currency, p.lines.map((l) => l.product_id)]);
const sellers = (parts) => parts.map((p) => [p.currency, p.agentBrand]);

// ── the split ─────────────────────────────────────────────────────────────
eq('a basket in one currency is one order',
  shape(splitOrders([line('gbp1'), line('gbp2')], lookup)),
  [['GBP', ['gbp1', 'gbp2']]]);

eq('a basket in two is two orders, with every line kept',
  shape(splitOrders([line('gbp1'), line('eur1'), line('gbp2')], lookup)),
  [['GBP', ['gbp1', 'gbp2']], ['EUR', ['eur1']]]);

eq('sterling comes first whichever order the basket was built in',
  shape(splitOrders([line('eur1'), line('gbp1')], lookup)),
  [['GBP', ['gbp1']], ['EUR', ['eur1']]]);

eq('lines keep the order they were added in, within their currency',
  shape(splitOrders([line('eur2'), line('eur1')], lookup)),
  [['EUR', ['eur2', 'eur1']]]);

eq('an empty basket is no orders at all', splitOrders([], lookup), []);

// Losing a line silently would be worse than putting it in the commonest
// currency, where the price on the confirmation shows it up.
eq('a product the catalogue does not know is kept, as sterling',
  shape(splitOrders([line('mystery')], lookup)), [['GBP', ['mystery']]]);

// The same product twice is two lines and must stay two: a basket can hold a
// size on its own line after an earlier add.
eq('the same product twice stays twice',
  splitOrders([line('gbp1', 2), line('gbp1', 3)], lookup)[0].lines.length, 2);

// ── the seller ────────────────────────────────────────────────────────────
// The whole point: one document, one seller. Our goods and DRAG's cannot
// share an invoice however convenient that would be for the customer.
eq('goods we sell and goods we introduce become separate orders',
  shape(splitOrders([line('eur1'), line('drag1')], lookup)),
  [['EUR', ['eur1']], ['EUR', ['drag1']]]);

eq('and each says who is selling it',
  sellers(splitOrders([line('eur1'), line('drag1')], lookup)),
  [['EUR', null], ['EUR', 'drag']]);

eq('our own goods come first',
  sellers(splitOrders([line('drag1'), line('eur1')], lookup)),
  [['EUR', null], ['EUR', 'drag']]);

eq('two lines from one introduced brand are one order',
  shape(splitOrders([line('drag1'), line('drag2')], lookup)),
  [['EUR', ['drag1', 'drag2']]]);

// Each brand invoices separately, so two of them is two orders even though
// nothing about the currency has changed.
eq('two introduced brands in one currency are two orders',
  sellers(splitOrders([line('acme1'), line('gbp1')], lookup)),
  [['GBP', null], ['GBP', 'acme']]);

eq('currency splits before seller does',
  sellers(splitOrders([line('drag1'), line('acme1'), line('gbp1'), line('eur1')], lookup)),
  [['GBP', null], ['GBP', 'acme'], ['EUR', null], ['EUR', 'drag']]);

eq('introduced brands are ordered by name among themselves',
  sellers(splitOrders(
    [line('drag1'), line('acme1')],
    (id) => ({ ...CATALOGUE[id], currency: 'GBP' }))),
  [['GBP', 'acme'], ['GBP', 'drag']]);

// A product the catalogue does not know is ours until it says otherwise —
// quietly telling a customer somebody else carries the warranty would be the
// worse way to be wrong.
eq('an unknown product is our own, not an introduced one',
  sellers(splitOrders([line('mystery')], lookup)), [['GBP', null]]);

eq('sterling first, then the rest alphabetically',
  orderCurrencies(['USD', 'EUR', 'GBP']), ['GBP', 'EUR', 'USD']);
eq('and a currency named twice appears once',
  orderCurrencies(['EUR', 'EUR']), ['EUR']);
eq('no sterling is not a special case', orderCurrencies(['USD', 'EUR']), ['EUR', 'USD']);

// ── the totals the customer is shown ──────────────────────────────────────
const basket = [
  { currency: 'GBP', net: 100 },
  { currency: 'EUR', net: 200 },
  { currency: 'GBP', net: 50 },
];
const totals = totalsByCurrency(basket, (l) => l.currency, (l) => l.net, 20);
eq('one total per currency', totals.map((t) => t.currency), ['GBP', 'EUR']);
eq('each adding up only its own lines', totals.map((t) => t.net), [150, 200]);
eq('with VAT on each separately', totals.map((t) => t.vat), [30, 40]);
// The whole point: no figure anywhere is 350.
eq('nothing is the sum of both', totals.some((t) => t.net === 350), false);

eq('a zero VAT rate is a rate, not a missing one',
  totalsByCurrency(basket, (l) => l.currency, (l) => l.net, 0).map((t) => t.vat), [0, 0]);
eq('an empty basket totals nothing',
  totalsByCurrency([], (l) => l.currency, (l) => l.net, 20), []);

process.exit(fail ? 1 : 0);
