// Whether a row's Model and Size columns amount to a frame size.
//
// This exists because getting it wrong once dropped every row of any sheet
// with a Size column on it — rotor diameters, cassette ratios, bar widths —
// and a dropped row is a price that never lands. A half-filled pair must cost
// the row its grouping and nothing else.
const { variantPair, sizesLookWrong } =
  await import('../../.test-build/import/variant-pair.js');

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

// ── a Size column that is not holding sizes ───────────────────────────────
//
// The failure this exists for: a saved layout pinned to column letters,
// applied to a sheet with a column inserted, so Size landed on Series. Every
// Dura-Ace part claimed to be size "Dura-Ace" and the import reported
// eighty-one pairs of products as duplicates of each other — all true, none
// of them naming the cause.
const range = (group, labels) => labels.map((l, i) =>
  ({ sku: `${group}-${i}`, variant_group: group, variant_label: l }));

eq('a sheet whose models each have one size between them is wrong',
   sizesLookWrong([
     ...range('CHAINSETS', ['Dura-Ace', 'Dura-Ace', 'Dura-Ace']),
     ...range('CASSETTES', ['Dura-Ace', 'Dura-Ace']),
     ...range('WIRES', ['Di2', 'Di2']),
   ])?.value, 'Dura-Ace');
eq('and it says how much of the sheet is like that',
   (({ models, rows }) => ({ models, rows }))(sizesLookWrong([
     ...range('CHAINSETS', ['Dura-Ace', 'Dura-Ace', 'Dura-Ace']),
     ...range('CASSETTES', ['Dura-Ace', 'Dura-Ace']),
     ...range('WIRES', ['Di2', 'Di2']),
   ])), { models: 3, rows: 7 });

// The ordinary case must never trip it, or the warning is noise on every
// import and gets read as noise on the one that matters.
eq('a sheet of real sizes is fine',
   sizesLookWrong([
     ...range('CHAINSETS', ['50/34 170mm', '52/36 170mm', '54/40 172.5mm']),
     ...range('ROTORS', ['140mm', '160mm', '180mm']),
   ]), null);

// One model listed twice at one size is a duplicate row, not a wrong column.
eq('a single repeated model is not enough to accuse a column',
   sizesLookWrong([
     ...range('CHAINSETS', ['50/34 170mm', '52/36 170mm']),
     ...range('CASSETTES', ['11-30T', '11-34T']),
     ...range('ODDITY', ['One', 'One']),
   ]), null);

// A model of one member has no sizes to compare, so it says nothing either way.
eq('products sold on their own are not evidence',
   sizesLookWrong([
     { sku: 'A', variant_group: 'X', variant_label: 'Dura-Ace' },
     { sku: 'B', variant_group: 'Y', variant_label: 'Dura-Ace' },
   ]), null);
eq('and neither is a sheet with no grouping at all',
   sizesLookWrong([{ sku: 'A' }, { sku: 'B' }]), null);
eq('nor an empty one', sizesLookWrong([]), null);

process.exit(fail ? 1 : 0);
