// What a specced build puts on an order.
//
// A build is a way of choosing, not a thing we sell, so what lands on the
// order is components at their own SKUs. The arithmetic is the part worth
// being sure of: a step needing two rotors, ordered as three builds, is six
// rotors, and nobody notices that being wrong on a busy afternoon.
const { preselect, missingSteps, canBuild, buildLines, buildNet } =
  await import('../../.test-build/orders/build.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const step = (id, name, qty, required, ...ids) =>
  ({ id, name, qty, required, options: ids.map((product_id) => ({ product_id })) });

const STEPS = [
  step('chainset', 'Chainset', 1, true, 'crank-170', 'crank-1725'),
  step('cassette', 'Cassette', 1, true, 'cs-1130', 'cs-1134'),
  step('rotors', 'Rotors', 2, true, 'rotor-140', 'rotor-160'),
  step('meter', 'Power meter', 1, false, 'meter-4iiii'),
];
const FULL = {
  chainset: 'crank-170', cassette: 'cs-1130', rotors: 'rotor-140',
};
const PRICE = { 'crank-170': 480, 'cs-1130': 210, 'rotor-140': 62, 'meter-4iiii': 640 };
const priceOf = (id) => PRICE[id];

// ── what answers itself ───────────────────────────────────────────────────
eq('a required step with one option needs no asking',
  preselect([step('only', 'Rotors', 1, true, 'rotor-140')]), { only: 'rotor-140' });
// A lone optional extra is still an extra.
eq('an optional step is never preselected, however few options it has',
  preselect([step('meter', 'Power meter', 1, false, 'meter-4iiii')]), {});
eq('a required step with a real choice is left blank',
  preselect(STEPS), {});

// ── what is not in this build ─────────────────────────────────────────────
// Naming them, not forbidding them. A shop buying a groupset often already
// has the brakes; what goes on the order is components at their own SKUs, and
// there is no groupset line for a missing part to make nonsense of.
eq('every required step is named while blank',
  missingSteps(STEPS, {}).map((s) => s.name), ['Chainset', 'Cassette', 'Rotors']);
eq('and none once they are answered', missingSteps(STEPS, FULL), []);
eq('an unanswered optional step is not missing',
  missingSteps(STEPS, FULL).map((s) => s.id), []);

// ── the lines ─────────────────────────────────────────────────────────────
eq('one line per chosen component, at its own SKU',
  buildLines(STEPS, FULL).map((l) => l.productId), ['crank-170', 'cs-1130', 'rotor-140']);
// The case this file exists for.
eq('a step needing two rotors orders two', buildLines(STEPS, FULL)[2].qty, 2);
eq('and three builds of it order six', buildLines(STEPS, FULL, 3)[2].qty, 6);
eq('while a step needing one orders one per build',
  buildLines(STEPS, FULL, 3)[0].qty, 3);

eq('an optional step left alone puts nothing on the order',
  buildLines(STEPS, FULL).length, 3);
eq('and taken up, it goes on like anything else',
  buildLines(STEPS, { ...FULL, meter: 'meter-4iiii' }).map((l) => l.productId),
  ['crank-170', 'cs-1130', 'rotor-140', 'meter-4iiii']);

eq('nothing chosen is nothing ordered', buildLines(STEPS, {}), []);
// Stale state from a build closed and reopened must not smuggle a component
// onto the order that this build does not offer.
eq('a choice this build does not offer is ignored',
  buildLines(STEPS, { chainset: 'something-else' }), []);

eq('a count below one is still one build', buildLines(STEPS, FULL, 0)[0].qty, 1);
eq('and a fractional one is floored, never rounded up',
  buildLines(STEPS, FULL, 2.9)[0].qty, 2);

// ── the total ─────────────────────────────────────────────────────────────
// 480 + 210 + 2 × 62
eq('the total counts each component at its own quantity',
  buildNet(STEPS, FULL, 1, priceOf), 814);
eq('and scales with the number of builds', buildNet(STEPS, FULL, 2, priceOf), 1628);
eq('an optional extra is added when taken',
  buildNet(STEPS, { ...FULL, meter: 'meter-4iiii' }, 1, priceOf), 1454);
// A component with no price for this tier counts as nothing rather than NaN:
// one unpriced option must not blank the whole total.
eq('a component with no price on this tier does not poison the total',
  buildNet(STEPS, { ...FULL, cassette: 'cs-1134' }, 1, priceOf), 604);
eq('nothing chosen comes to nothing', buildNet(STEPS, {}, 1, priceOf), 0);

// ── whether there is anything to order ────────────────────────────────────
// The only real constraint. It used to be "every required step answered",
// which made every part of a groupset compulsory: clear the brakes and the
// button went dead with no way forward.
eq('a build with something in it can be ordered', canBuild(STEPS, FULL), true);
eq('and so can one with a required step left out',
   canBuild(STEPS, { cassette: 'cs-1130' }), true);
eq('even down to a single component',
   canBuild(STEPS, { rotors: 'rotor-140' }), true);
eq('but a build of nothing is not an order', canBuild(STEPS, {}), false);
// A stale choice is not a component either: the same rule buildLines uses.
eq('nor is one whose only choice is not on offer',
   canBuild(STEPS, { chainset: 'something-else' }), false);

process.exit(fail ? 1 : 0);
