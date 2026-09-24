// What one client has bought from us.
//
// The summary sits above their orders on the staff screen, and the whole of
// its job is to be the number somebody quotes without opening anything. Two
// ways that goes wrong and both are silent: a cancelled order counted as
// money that arrived, and two currencies added into one figure that is
// neither.
const { summarise, orderNet } =
  await import('../../.test-build/orders/history.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const order = (date, status, currency, lines) => ({
  date, status, currency, order_lines: lines.map(([qty, unit_price]) => ({ qty, unit_price })),
});

// ── one line at a time ────────────────────────────────────────────────────
eq('an order is its lines', orderNet(order('2026-01-05', 'complete', 'GBP', [[2, 10], [1, 5.5]])), 25.5);
eq('an order with no lines is nothing', orderNet(order('2026-01-05', 'open', 'GBP', [])), 0);
// Supabase hands numerics back as strings often enough that this has to hold.
eq('and numbers that arrived as text still add up',
   orderNet({ order_lines: [{ qty: '3', unit_price: '4.25' }] }), 12.75);

// ── the summary ───────────────────────────────────────────────────────────
const history = summarise([
  order('2026-03-04', 'complete',  'GBP', [[1, 100]]),
  order('2025-11-20', 'complete',  'GBP', [[2, 50]]),
  order('2026-01-15', 'open',      'GBP', [[1, 25]]),
  order('2026-02-02', 'cancelled', 'GBP', [[1, 9999]]),
]);

eq('cancelled orders are not orders they placed', history.placed, 3);
eq('but they are not hidden either', history.cancelled, 1);
// The one that matters. 100 + 100 + 25; the cancelled 9,999 is not money.
eq('and their money is never in the total', history.totals, [{ currency: 'GBP', net: 225 }]);

eq('the range starts at their first', history.first, '2025-11-20');
eq('and ends at their latest', history.last, '2026-03-04');
// Taken from the orders that count. A cancelled order in February must not
// stretch a range that otherwise ends in January.
eq('a cancelled order does not stretch the range',
   summarise([
     order('2026-01-15', 'open',      'GBP', [[1, 25]]),
     order('2026-02-02', 'cancelled', 'GBP', [[1, 10]]),
   ]).last,
   '2026-01-15');

// ── two currencies ────────────────────────────────────────────────────────
// Vision come from Italy in euros. Adding them to sterling would need a rate,
// and the only rate available is today's, applied to an order placed last
// year. Two true figures beat one false one.
const mixed = summarise([
  order('2026-03-04', 'complete', 'GBP', [[1, 100]]),
  order('2026-03-05', 'complete', 'EUR', [[1, 80]]),
  order('2026-03-06', 'complete', 'EUR', [[1, 20]]),
]);
eq('each currency totals on its own', mixed.totals,
   [{ currency: 'GBP', net: 100 }, { currency: 'EUR', net: 100 }]);
eq('sterling leads, whatever order they arrived in',
   summarise([
     order('2026-03-05', 'complete', 'EUR', [[1, 80]]),
     order('2026-03-04', 'complete', 'GBP', [[1, 100]]),
   ]).totals.map((t) => t.currency),
   ['GBP', 'EUR']);
// An order row with no currency on it is sterling, not a fourth column.
eq('a missing currency is sterling',
   summarise([order('2026-03-04', 'complete', null, [[1, 10]])]).totals,
   [{ currency: 'GBP', net: 10 }]);

// ── a client who has never ordered ────────────────────────────────────────
// The screen says "has never ordered" off the back of this, so it must be an
// empty summary rather than a thrown error or a zero-pound total.
const never = summarise([]);
eq('no orders is no orders', never.placed, 0);
eq('with no dates to show', [never.first, never.last], [null, null]);
eq('and nothing to total', never.totals, []);

// A client whose only order was cancelled has still never bought anything,
// and the screen should not print a £0.00 lifetime figure at them.
const onlyCancelled = summarise([order('2026-02-02', 'cancelled', 'GBP', [[1, 50]])]);
eq('one cancelled order is not a customer yet', onlyCancelled.placed, 0);
eq('and totals nothing rather than zero', onlyCancelled.totals, []);
eq('though the cancellation is still on the record', onlyCancelled.cancelled, 1);

process.exit(fail ? 1 : 0);
