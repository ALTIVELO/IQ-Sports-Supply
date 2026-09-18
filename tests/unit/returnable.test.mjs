// What the returns form is allowed to offer back.
//
// The database is the authority — returnable_qty() and request_return() run
// inside the transaction that writes the row. These are the same two sums
// done on the page so it can show a number, and this file exists to keep them
// saying the same thing. A form that offers back stock the database then
// refuses tells a customer yes and then no in the same minute.
const { claimedByLine, leftToReturn, windowClosed, lastDispatch } =
  await import('../../.test-build/returns/returnable.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};
const map = (m) => Object.fromEntries(m);

// ── how much is left ──────────────────────────────────────────────────────
const LINES = [{ id: 'a', qty: 4 }, { id: 'b', qty: 2 }, { id: 'c', qty: 1 }];

eq('nothing reported leaves the whole line',
   map(leftToReturn(LINES, [])), { a: 4, b: 2, c: 1 });

eq('a part return leaves the rest',
   map(leftToReturn(LINES, [{ order_line_id: 'a', qty: 1 }])), { a: 3, b: 2, c: 1 });

// The clicked-twice case: two requests, neither read yet, both still count.
eq('two open requests on one line both hold their quantity',
   map(leftToReturn(LINES, [
     { order_line_id: 'a', qty: 2 }, { order_line_id: 'a', qty: 2 },
   ])), { a: 0, b: 2, c: 1 });

eq('a line reported in full has nothing left',
   map(leftToReturn(LINES, [{ order_line_id: 'c', qty: 1 }])), { a: 4, b: 2, c: 0 });

// Only a bug could produce this, and the answer is still not a negative
// number offered to a customer as a quantity.
eq('more claimed than was bought floors at nothing',
   map(leftToReturn(LINES, [{ order_line_id: 'c', qty: 9 }])), { a: 4, b: 2, c: 0 });

eq('claims are summed per line',
   map(claimedByLine([
     { order_line_id: 'a', qty: 1 }, { order_line_id: 'b', qty: 3 },
     { order_line_id: 'a', qty: 2 },
   ])), { a: 3, b: 3 });

// Declined and cancelled returns are excluded by the query, not here, so what
// arrives is already only the live ones.
eq('a line nobody has touched is absent from the claims',
   claimedByLine([{ order_line_id: 'a', qty: 1 }]).get('b'), undefined);

// ── when the window shuts ─────────────────────────────────────────────────
const NOW = new Date('2026-09-18T11:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

eq('dispatched today is inside it', windowClosed(daysAgo(0), 30, NOW), false);
eq('dispatched a fortnight ago is inside it', windowClosed(daysAgo(14), 30, NOW), false);
// "Within 30 days" read by a customer means the thirtieth day counts.
eq('the last day of the window still counts', windowClosed(daysAgo(30), 30, NOW), false);
eq('the day after does not', windowClosed(daysAgo(31), 30, NOW), true);
eq('seven months later is long shut', windowClosed(daysAgo(210), 30, NOW), true);
// Nothing dispatched is not an expired window; it is a different message.
eq('nothing dispatched is not a closed window', windowClosed(null, 30, NOW), false);
eq('an unreadable date is not a closed window', windowClosed('not a date', 30, NOW), false);
eq('a window of zero days shuts the next day', windowClosed(daysAgo(1), 0, NOW), true);

// ── which dispatch the window runs from ───────────────────────────────────
const inv = (shipped, at, superseded = false) =>
  ({ shipped, shipped_at: at, superseded });

eq('one shipment is the date',
   lastDispatch([inv(true, '2026-09-01T09:00:00Z')]), '2026-09-01T09:00:00Z');

// A part-shipped order's window runs from the last box, not the first: the
// second half has not spent its window sitting in our warehouse.
eq('the later of two shipments is the date',
   lastDispatch([inv(true, '2026-09-01T09:00:00Z'), inv(true, '2026-09-11T09:00:00Z')]),
   '2026-09-11T09:00:00Z');

eq('an unshipped invoice does not count',
   lastDispatch([inv(false, null), inv(true, '2026-09-02T09:00:00Z')]),
   '2026-09-02T09:00:00Z');

// A superseded invoice was withdrawn; the goods on it were never billed.
eq('a superseded invoice does not count',
   lastDispatch([inv(true, '2026-09-20T09:00:00Z', true), inv(true, '2026-09-02T09:00:00Z')]),
   '2026-09-02T09:00:00Z');

eq('nothing shipped is null', lastDispatch([inv(false, null)]), null);
eq('no invoices at all is null', lastDispatch([]), null);

process.exit(fail ? 1 : 0);
