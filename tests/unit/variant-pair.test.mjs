// Whether a row's Model and Size columns amount to a frame size.
//
// This exists because getting it wrong once dropped every row of any sheet
// with a Size column on it — rotor diameters, cassette ratios, bar widths —
// and a dropped row is a price that never lands. A half-filled pair must cost
// the row its grouping and nothing else.
const { variantPair } = await import('../../.test-build/import/variant-pair.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

eq('both halves make a frame size',
  variantPair('DRAG-STORM-7-0', 'M'),
  { group: 'DRAG-STORM-7-0', label: 'M', halfPaired: false });

// The failure this file is named for: a rotor list with a Size column.
eq('a size with no model is not a frame size, and not an error either',
  variantPair(undefined, '140mm'), { halfPaired: true });
eq('nor is a model with no size', variantPair('SOMETHING', undefined), { halfPaired: true });
eq('and neither carries a group or a label onward',
  [variantPair(undefined, '140mm').group, variantPair('X', undefined).label],
  [undefined, undefined]);

eq('neither half is the ordinary case, and is not flagged',
  variantPair(undefined, undefined), { halfPaired: false });
eq('blank cells count as neither half',
  variantPair('  ', ''), { halfPaired: false });
eq('whitespace around a real pair is trimmed',
  variantPair('  DRAG-STORM-7-0 ', ' M '),
  { group: 'DRAG-STORM-7-0', label: 'M', halfPaired: false });
eq('a blank model beside a real size is still only half',
  variantPair('   ', 'M'), { halfPaired: true });

// A size that is only a number is still a size: 440mm frames are a real thing.
eq('a numeric size pairs like any other',
  variantPair('OLDTIMER', '440'),
  { group: 'OLDTIMER', label: '440', halfPaired: false });

process.exit(fail ? 1 : 0);
