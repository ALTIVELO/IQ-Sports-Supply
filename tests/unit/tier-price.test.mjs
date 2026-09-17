// A product nobody has priced on a tier has no price on that tier.
//
// It does not have a price of zero. Rendering one is the most expensive
// mistake the order desk can make: £0.00 reads as free, and nothing between
// the screen and the invoice questions it.
const { tierPrice, priceRange } =
  await import('../../.test-build/orders/tier-price.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const PRICES = { distributor: 204.34, shop: 214.56, club: 224.77, free: 0 };

// ── one price ─────────────────────────────────────────────────────────────
eq('a tier that prices it gets its price', tierPrice(PRICES, 'distributor'), 204.34);
// The bug this exists to stop.
eq('a tier that does not is undefined, never zero', tierPrice(PRICES, 'club-elite'), undefined);
eq('no tier at all is undefined', tierPrice(PRICES, undefined), undefined);
eq('no prices at all is undefined', tierPrice(undefined, 'shop'), undefined);
eq('an empty price list is undefined', tierPrice({}, 'shop'), undefined);
// A genuine zero is a price somebody typed, and has to survive.
eq('a real zero is still a price', tierPrice(PRICES, 'free'), 0);
eq('and is not confused with a missing one', tierPrice(PRICES, 'free') === undefined, false);
// Anything that is not a finite number is nothing, rather than NaN on screen.
eq('a NaN is not a price', tierPrice({ shop: NaN }, 'shop'), undefined);
eq('nor is a string that got through', tierPrice({ shop: '12' }, 'shop'), undefined);

// ── a range across sizes ──────────────────────────────────────────────────
eq('a range over priced sizes', priceRange([429, 444, 459]),
  { low: 429, high: 459, unpriced: 0 });
eq('one price across every size is not a range',
  priceRange([429, 429]), { low: 429, high: 429, unpriced: 0 });

// The exact failure: one unpriced frame dragged the whole bike to "from £0.00".
eq('an unpriced size does not drag the range to zero',
  priceRange([429, undefined, 459]), { low: 429, high: 459, unpriced: 1 });
// And it is not dropped silently either — a range that covers three of five
// sizes has to say so.
eq('it is counted so the screen can say so',
  priceRange([429, undefined, undefined]).unpriced, 2);

eq('no size priced at all has no range',
  priceRange([undefined, undefined]), { low: undefined, high: undefined, unpriced: 2 });
eq('nothing at all has no range', priceRange([]), { low: undefined, high: undefined, unpriced: 0 });
// A genuinely free size is in the range, not counted as missing.
eq('a real zero is in the range', priceRange([0, 100]), { low: 0, high: 100, unpriced: 0 });

process.exit(fail ? 1 : 0);
