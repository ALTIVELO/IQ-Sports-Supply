// Turning one basket into the orders it will actually become.
//
// An order and its invoice each ask for one currency, so a basket holding two
// is two orders. The figures matter as much as the grouping: the customer is
// about to be shown a total per invoice, and a screen that adds euros to
// pounds shows a number nobody is billed.
const { splitByCurrency, totalsByCurrency, orderCurrencies } =
  await import('../../.test-build/orders/split.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const CURRENCY = { eur1: 'EUR', eur2: 'EUR', gbp1: 'GBP', gbp2: 'GBP' };
const lookup = (id) => CURRENCY[id];
const line = (product_id, qty = 1) => ({ product_id, qty });
const shape = (parts) =>
  parts.map((p) => [p.currency, p.lines.map((l) => l.product_id)]);

// ── the split ─────────────────────────────────────────────────────────────
eq('a basket in one currency is one order',
  shape(splitByCurrency([line('gbp1'), line('gbp2')], lookup)),
  [['GBP', ['gbp1', 'gbp2']]]);

eq('a basket in two is two orders, with every line kept',
  shape(splitByCurrency([line('gbp1'), line('eur1'), line('gbp2')], lookup)),
  [['GBP', ['gbp1', 'gbp2']], ['EUR', ['eur1']]]);

eq('sterling comes first whichever order the basket was built in',
  shape(splitByCurrency([line('eur1'), line('gbp1')], lookup)),
  [['GBP', ['gbp1']], ['EUR', ['eur1']]]);

eq('lines keep the order they were added in, within their currency',
  shape(splitByCurrency([line('eur2'), line('eur1')], lookup)),
  [['EUR', ['eur2', 'eur1']]]);

eq('an empty basket is no orders at all', splitByCurrency([], lookup), []);

// Losing a line silently would be worse than putting it in the commonest
// currency, where the price on the confirmation shows it up.
eq('a product the catalogue does not know is kept, as sterling',
  shape(splitByCurrency([line('mystery')], lookup)), [['GBP', ['mystery']]]);

// The same product twice is two lines and must stay two: a basket can hold a
// size on its own line after an earlier add.
eq('the same product twice stays twice',
  splitByCurrency([line('gbp1', 2), line('gbp1', 3)], lookup)[0].lines.length, 2);

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
