// Folding a flat product list back into bikes with sizes.
//
// The catalogue reads one list of products from the database and has to show
// one line per bike. Getting this wrong is visible immediately — five lines
// where there should be one — but the subtle failures are the ones tested
// here: the order sizes come out in, and which row the tile is drawn from.
const { groupVariants, groupName, sizeRank, knownSize, skuPrefix } =
  await import('../../.test-build/catalogue/variants.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const p = (id, over = {}) => ({
  id, sku: id, name: id, brand: 'DRAG', price: 100, currency: 'EUR',
  in_stock: false, image_url: null, category_slug: null, category_name: null,
  configurator_only: false, price_note: null,
  variant_group: null, variant_label: null, variant_sort: null, ...over,
});
const size = (label, over = {}) =>
  p(`STORM-${label}`, { variant_group: 'STORM', variant_label: label, ...over });
const labels = (g) => g.sizes.map((s) => s.variant_label);

// ── folding ───────────────────────────────────────────────────────────────
eq('a product with no sizes is a group of one',
  groupVariants([p('A')]).map((g) => [g.key, g.sizes.length]), [['A', 1]]);

eq('five frames of one bike are one group',
  groupVariants(['S', 'M', 'L', 'XL', 'XXL'].map(size)).length, 1);

eq('two bikes stay two',
  groupVariants([size('M'), p('B', { variant_group: 'RONIN', variant_label: 'M' })]).length, 2);

// Order in, order out: the screen sorted the query, and re-sorting here would
// override what it asked for.
eq('groups appear where their first size appeared',
  groupVariants([p('A'), size('M'), p('B')]).map((g) => g.key), ['A', 'STORM', 'B']);

// ── the size scale ────────────────────────────────────────────────────────
eq('sizes come out small to large, not alphabetically',
  labels(groupVariants([size('XL'), size('S'), size('XXL'), size('M'), size('L')])[0]),
  ['S', 'M', 'L', 'XL', 'XXL']);
eq('XS sorts below S, not next to XL',
  labels(groupVariants([size('S'), size('XL'), size('XS')])[0]), ['XS', 'S', 'XL']);
eq('lower case is the same size',
  labels(groupVariants([size('m'), size('s')])[0]), ['s', 'm']);
eq('numeric frame sizes sort as numbers',
  labels(groupVariants([size('570'), size('440'), size('500')])[0]), ['440', '500', '570']);
eq('and sort after the lettered ones, not among them',
  labels(groupVariants([size('440'), size('M')])[0]), ['M', '440']);

// An explicit order from the import wins, which is the point of storing it.
eq('an explicit sort beats the scale',
  labels(groupVariants([
    size('S', { variant_sort: 2 }), size('L', { variant_sort: 1 }),
  ])[0]), ['L', 'S']);

eq('XXL is a size the scale knows', knownSize('XXL'), true);
eq('440 is not', knownSize('440'), false);
eq('nothing is not', knownSize(null), false);
eq('a letter size ranks before a number', sizeRank('M')[0] < sizeRank('440')[0], true);

// ── what the tile is drawn from ───────────────────────────────────────────
eq('the lead is the first size when none has a photo',
  groupVariants([size('M'), size('L')])[0].lead.sku, 'STORM-M');
eq('but a size with a photo is preferred, wherever it sits in the range',
  groupVariants([size('M'), size('L', { image_url: 'x.jpg' })])[0].lead.sku, 'STORM-L');

// ── price range and stock ─────────────────────────────────────────────────
const priced = groupVariants([size('M', { price: 1200 }), size('L', { price: 1350 })])[0];
eq('the range runs from the cheapest frame', priced.low, 1200);
eq('to the dearest', priced.high, 1350);
eq('one price across every size is not a range',
  (() => { const g = groupVariants([size('M'), size('L')])[0]; return g.low === g.high; })(), true);
eq('a bike is in stock when any size is',
  groupVariants([size('M'), size('L', { in_stock: true })])[0].inStock, true);
eq('and out of it when none is', groupVariants([size('M'), size('L')])[0].inStock, false);

// ── the name without the size on the end ──────────────────────────────────
const named = (name, label, others = ['L']) => groupName(groupVariants([
  { ...size(label), name }, ...others.map((o) => size(o)),
])[0]);
eq('a trailing size is dropped from the name', named('28 Storm 7.0 — M', 'M'), '28 Storm 7.0');
eq('however it was punctuated', named('28 Storm 7.0 (M)', 'M'), '28 Storm 7.0');
eq('and with no punctuation at all', named('28 Storm 7.0 M', 'M'), '28 Storm 7.0');
// Only a trailing size, and only on a bike that has sizes: a part called
// "M-series chainring" must not lose its name.
eq('a size in the middle of a name is left alone',
  named('M-series chainring', 'M'), 'M-series chainring');
eq('a product with no sizes keeps its whole name',
  groupName(groupVariants([p('A', { name: 'Bar tape M' })])[0]), 'Bar tape M');

// ── the part number a range shares ────────────────────────────────────────
// Every size has its own SKU; the line that stands for all of them needs the
// part somebody would quote to ask about the model.
eq('Shimano numbering leaves the model as the common prefix',
   skuPrefix(['FCR9200M04', 'FCR9200A04', 'FCR9200E40']), 'FCR9200');
eq('a rotor range too', skuPrefix(['RTCL900LJ', 'RTCL900SSE', 'RTCL900MI']), 'RTCL900');
eq('one product on its own is its own part number',
   skuPrefix(['BBUN300B07']), 'BBUN300B07');
// 52 and 56 share a 5, so the raw prefix is "DRG-OMEGA-5": half a frame size,
// reading as a part number. Where the scheme has separators, cut back to one.
eq('half a size is not left on the end',
   skuPrefix(['DRG-OMEGA-52', 'DRG-OMEGA-56']), 'DRG-OMEGA');
eq('and a whole segment is kept',
   skuPrefix(['DRG-OMEGA-52', 'DRG-OMEGA-XL']), 'DRG-OMEGA');
// "F" over a chainset is worse than nothing, and an empty line worse still.
eq('a prefix too short to identify anything is nothing',
   skuPrefix(['FCR9200', 'FDR8150']), null);
eq('and no shared prefix at all is nothing',
   skuPrefix(['ABC123', 'XYZ789']), null);
eq('nothing at all is nothing', skuPrefix([]), null);
eq('the floor can be moved where a scheme is shorter',
   skuPrefix(['AB1', 'AB2'], 2), 'AB');

process.exit(fail ? 1 : 0);
