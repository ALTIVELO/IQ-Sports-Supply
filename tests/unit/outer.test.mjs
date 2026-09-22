// The price on the sheet is the price by the outer.
//
// Shimano sell by the carton — a shifter in tens, a charging cable in
// hundreds — and the trade price we publish is the price at that quantity.
// Below it the part costs more. This is the rule every screen uses to say so
// before somebody commits, and it has to agree with price_for_qty() in the
// database, which is what actually prices the invoice.
const { hasOuter, priceAtQty, shortOfOuter, outerSaving } =
  await import('../../.test-build/catalogue/outer.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// A Dura-Ace shifter: ten to a box at 204.34, or one at a time at 248.40.
const shifter = { price: 204.34, moq: 10, break_price: 248.40 };
const single = { price: 5.71, moq: 1, break_price: null };
// An outer with no loose price — the power chainsets, which the supplier
// prices by the carton and not at all below it.
const noLoose = { price: 496.80, moq: 8, break_price: null };

// ── which products have two prices ────────────────────────────────────────
eq('a part boxed in tens with a loose price has two', hasOuter(shifter), true);
eq('a part sold in ones has one', hasOuter(single), false);
eq('and so does an outer nobody priced loose', hasOuter(noLoose), false);
// Both halves are needed. An MOQ on its own says how they arrive, not what
// they cost, and pricing off it would invent a number.
eq('an outer with no loose price is not two prices',
   hasOuter({ price: 10, moq: 5, break_price: null }), false);
eq('and a loose price with no outer is not either',
   hasOuter({ price: 10, moq: 1, break_price: 12 }), false);
eq('a missing moq reads as one', hasOuter({ price: 10, moq: null, break_price: 12 }), false);

// ── the boundary, which is the whole feature ──────────────────────────────
eq('at the outer exactly, the advertised price', priceAtQty(shifter, 10), 204.34);
eq('and above it', priceAtQty(shifter, 11), 204.34);
eq('four cartons is still the carton price', priceAtQty(shifter, 40), 204.34);
eq('one short of a carton is the loose price', priceAtQty(shifter, 9), 248.40);
eq('and so is one', priceAtQty(shifter, 1), 248.40);
// "What does one cost" is the honest answer to a basket with nothing in it.
eq('nothing chosen quotes what one would cost', priceAtQty(shifter, 0), 248.40);
eq('a part sold in ones ignores the quantity', priceAtQty(single, 1), 5.71);
eq('however many', priceAtQty(single, 500), 5.71);
eq('and an outer with no loose price sells at the outer price',
   priceAtQty(noLoose, 1), 496.80);

// ── how far short, and what it is worth ───────────────────────────────────
eq('three of ten is seven short', shortOfOuter(shifter, 3), 7);
eq('ten is not short', shortOfOuter(shifter, 10), 0);
eq('nor is eleven', shortOfOuter(shifter, 11), 0);
// Nothing chosen is not "short" — there is no line to make an offer about.
eq('an empty line is not short of anything', shortOfOuter(shifter, 0), 0);
eq('and a part sold in ones never is', shortOfOuter(single, 3), 0);

// Three loose at 248.40 is 745.20; a carton of ten is 2043.40, so filling it
// costs more, not less. The offer is only an offer where it is one.
eq('filling a carton of ten from three is not a saving',
   outerSaving(shifter, 3) > 0, false);

// A part boxed in twos is where it pays: one at 30 against two at 12 each.
const pair = { price: 12, moq: 2, break_price: 30 };
eq('one of a pair costs thirty', priceAtQty(pair, 1), 30);
eq('two cost twelve each', priceAtQty(pair, 2), 12);
eq('so taking the second saves six', outerSaving(pair, 1), 6);
eq('and once it is taken there is nothing to save', outerSaving(pair, 2), 0);

process.exit(fail ? 1 : 0);
