// Sending an order straight to the shop's own customer.
//
// The database is the authority — place_order refuses a direct delivery with
// no address or no acceptance — so what this covers is the screen agreeing
// with it. A button that can be pressed when the order would be refused is a
// customer finding out after committing, and a button that stays dead when
// the order is fine is a sale nobody can place.
const { emptyDropship, dropshipReady } =
  await import('../../.test-build/orders/dropship.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// An ordinary order is not held up by any of this.
eq('an order going to the client is always ready', dropshipReady(emptyDropship), true);
eq('however little is filled in beside it',
   dropshipReady({ on: false, shipTo: '', accepted: false }), true);
// Turned off, whatever was typed before is irrelevant — the order is not
// going there.
eq('and a stale address behind a cleared box does not block it',
   dropshipReady({ on: false, shipTo: '14 Cavendish Road', accepted: false }), true);

// The two conditions, and both are needed.
eq('a direct delivery with nothing filled in is not ready',
   dropshipReady({ on: true, shipTo: '', accepted: false }), false);
eq('an address on its own is not enough',
   dropshipReady({ on: true, shipTo: '14 Cavendish Road', accepted: false }), false);
eq('nor is an acceptance on its own',
   dropshipReady({ on: true, shipTo: '', accepted: true }), false);
eq('both together is ready',
   dropshipReady({ on: true, shipTo: '14 Cavendish Road', accepted: true }), true);

// Whitespace is not an address. The database trims and refuses a blank, so
// the screen has to refuse the same thing or the button lies.
eq('spaces are not an address',
   dropshipReady({ on: true, shipTo: '   \n  ', accepted: true }), false);
eq('and a newline on its own is not either',
   dropshipReady({ on: true, shipTo: '\n', accepted: true }), false);

// The blank state a fresh basket starts in.
eq('nothing is ticked to begin with', emptyDropship,
   { on: false, shipTo: '', accepted: false });

process.exit(fail ? 1 : 0);
