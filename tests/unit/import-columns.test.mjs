// Matching a price list's columns to our pricing tiers, and finding the one
// column that says what we pay. Getting the second wrong is the expensive
// mistake: a selling price read as a cost makes every margin look healthy.
const { guessMapping, guessCatalogueColumns, unclaimedMoneyColumns, sameHeaders } =
  await import('../../.test-build/import/parse.js');

let fail = 0;
// Keys land in confidence order, which is not something to assert on.
const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
const check = (label, got, want) => {
  const ok = canon(got) === canon(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}`
    + (ok ? '' : `  (got ${canon(got)}, wanted ${canon(want)})`));
};

const TIERS = [
  { id: 'dist', name: 'Distributor' },
  { id: 'shop', name: 'Shop' },
  { id: 'club', name: 'Club' },
  { id: 'retl', name: 'Retail' },
];
const BASE = { sku: 'A', name: 'B', brand: 'C' };
const guess = (header, sheet = 'Sheet1', base = BASE) =>
  guessCatalogueColumns(header, sheet, TIERS, base);

// ── the file this was built for ───────────────────────────────────────────
check('our own list: a cost column and one per tier',
  guess(['SKU', 'Description', 'Brand', 'Our cost', 'Distributor', 'Shop', 'Club', 'Retail']),
  { cost: 'D', 'price:dist': 'E', 'price:shop': 'F', 'price:club': 'G', 'price:retl': 'H' });

check('columns labelled "… price" read the same',
  guess(['SKU', 'Description', 'Brand', 'Cost price', 'Distributor price',
         'Shop price', 'Club price', 'Retail price']),
  { cost: 'D', 'price:dist': 'E', 'price:shop': 'F', 'price:club': 'G', 'price:retl': 'H' });

check('and so do the names a trade list actually uses',
  guess(['SKU', 'Description', 'Brand', 'Buy price', 'Wholesale', 'Dealer', 'Team', 'RRP']),
  { cost: 'D', 'price:dist': 'E', 'price:shop': 'F', 'price:club': 'G', 'price:retl': 'H' });

// "Retailer" is the Shop tier; "Retail" is the Retail tier. The longer,
// more specific name takes the column.
check('Retailer is the shop, not the retail tier',
  guess(['SKU', 'Description', 'Brand', 'Retailer', 'Retail']),
  { 'price:shop': 'D', 'price:retl': 'E' });

check('a tier the file does not price is left unmapped',
  guess(['SKU', 'Description', 'Brand', 'Distributor', 'Shop']),
  { 'price:dist': 'D', 'price:shop': 'E' });

// ── the older shape: one tab per tier, one price column ────────────────────
check('a tab named for a tier claims its lone price column',
  guess(['SKU', 'Description', 'Brand', 'Price'], 'Shop'),
  { 'price:shop': 'D' });

check('even when the tab is called "Shop prices 2026"',
  guess(['SKU', 'Description', 'Brand', 'Price (GBP)'], 'Shop prices 2026'),
  { 'price:shop': 'D' });

check('but not when the tab says nothing about a tier',
  guess(['SKU', 'Description', 'Brand', 'Price'], 'Sheet1'),
  {});

// Two money columns and only a tab name to go on is a guess, and a wrong
// guess here misprices a whole tier. It stays unmapped for a human to set.
check('nor when there is more than one price column to choose from',
  guess(['SKU', 'Description', 'Brand', 'Price', 'Amount'], 'Shop'),
  {});

// ── what must never be read as our cost ───────────────────────────────────
check('"Net price" is not assumed to be our cost',
  guess(['SKU', 'Description', 'Brand', 'Net price'], 'Sheet1'),
  {});

check('nor is "Trade price"',
  guess(['SKU', 'Description', 'Brand', 'Trade price'], 'Sheet1'),
  {});

// A supplier's own list: the only price on it is what we pay, but it is
// labelled as their price, not as a cost. It stays unmapped rather than being
// guessed into a tier — which is the honest answer, and the screen asks.
check('a supplier list headed only "Price" waits to be told',
  guess(['CODE', 'DESCRIPTION', 'PRICE'], 'JMM Distributor Price List',
        { sku: 'A', name: 'B' }),
  {});

// ── columns already spoken for ────────────────────────────────────────────
check('a column used for the SKU is never also a price',
  guess(['Product code', 'Description', 'Cost'], 'Sheet1',
        { sku: 'A', name: 'B' }),
  { cost: 'C' });

check('a distributor cost column goes to the tier, being the more specific',
  guess(['SKU', 'Description', 'Distributor cost'], 'Sheet1', { sku: 'A', name: 'B' }),
  { 'price:dist': 'C' });

// ── nothing to go on ──────────────────────────────────────────────────────
check('a sheet with no money columns maps nothing',
  guess(['SKU', 'Description', 'Brand', 'Category'], 'Sheet1'),
  {});

check('and a sentence across the top is not a header',
  guess(['IQ Sports Supply — distributor price list, effective 1 July 2026'],
        'Sheet1', {}),
  {});

// ── the column nothing claimed ────────────────────────────────────────────
// What the screen names when it has to ask whose price a column holds.
check('a lone unlabelled price column is reported so it can be assigned',
  unclaimedMoneyColumns(['SKU', 'Description', 'Brand', 'Price (GBP)'],
                        { sku: 'A', name: 'B', brand: 'C' }),
  [{ letter: 'D', label: 'Price (GBP)' }]);

check('a column already pointed at a tier is not reported',
  unclaimedMoneyColumns(['SKU', 'Description', 'Shop price'],
                        { sku: 'A', name: 'B', 'price:shop': 'C' }),
  []);

check('and neither is one already read as our cost',
  unclaimedMoneyColumns(['SKU', 'Description', 'Cost'],
                        { sku: 'A', name: 'B', cost: 'C' }),
  []);

check('a sheet with nothing money-shaped on it reports nothing',
  unclaimedMoneyColumns(['SKU', 'Description', 'Category'], { sku: 'A', name: 'B' }),
  []);

// ── the columns a bike list carries ───────────────────────────────────────
const col = (header, field) => guessMapping(header, ['sku', field])?.[field];

check('a Size column is the frame size',
  col(['SKU', 'Size'], 'variant_label'), 'B');
check('so is "Frame size"', col(['SKU', 'Frame size'], 'variant_label'), 'B');
check('a Model column groups the sizes',
  col(['SKU', 'Model'], 'variant_group'), 'B');
check('so does "Parent SKU"', col(['Code', 'Parent SKU'], 'variant_group'), 'B');
check('a Price note is found', col(['SKU', 'Price note'], 'price_note'), 'B');

// Both columns on one sheet, which is the shape the bike list actually has.
const bikes = guessMapping(
  ['Name', 'SKU', 'Brand', 'Category', 'Currency', 'Model', 'Size', 'Price note', 'Our cost'],
  ['sku', 'name', 'brand', 'category', 'currency', 'variant_group', 'variant_label',
   'price_note', 'cost']);
check('a whole bike list maps in one pass',
  [bikes.sku, bikes.name, bikes.currency, bikes.variant_group, bikes.variant_label,
   bikes.price_note],
  ['B', 'A', 'E', 'F', 'G', 'H']);

// ── whether a saved layout still describes this sheet ─────────────────────
//
// A layout is a set of column letters, and a letter only means something
// against the header row it was read from. This is the check that stopped a
// layout saved for last quarter's sheet being applied, letter for letter, to
// one with four columns inserted — which read Series as the Size and filed a
// hundred and eighteen products as size "Dura-Ace".
const LAST_QUARTER =
  ['Name','SKU','Brand','Category','Our cost','Distributor','Shop','Club','Retail'];
const THIS_QUARTER =
  ['Name','SKU','Brand','Series','Model','Size','Category','Image',
   'Our cost','Distributor','Shop','Club','Retail'];

// check() canonicalises objects, and Object.entries(true) is empty — every
// boolean would compare equal to every other. Plain values get their own.
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${ok ? '' : `  (got ${got}, wanted ${want})`}`);
};

is('the same sheet matches', sameHeaders(LAST_QUARTER, LAST_QUARTER), true);
is('a sheet with columns inserted does not',
   sameHeaders(LAST_QUARTER, THIS_QUARTER), false);
// A supplier re-exporting the same sheet changes the case and the spacing and
// nothing else, and re-doing the mapping over that would be a chore invented
// for no reason.
is('case and spacing do not count',
   sameHeaders(['Our Cost', 'SKU'], ['our  cost', 'sku ']), true);
is('nor do trailing blanks, which are a spreadsheet\'s own idea',
   sameHeaders(['SKU', 'Name'], ['SKU', 'Name', '', '']), true);
is('a renamed column is a different sheet',
   sameHeaders(['SKU', 'Name'], ['SKU', 'Title']), false);
// A layout saved before the headers were recorded cannot be checked, and one
// that cannot be checked is one to guess again rather than trust.
is('a layout with no headers recorded never matches',
   sameHeaders([], LAST_QUARTER), false);
is('and neither does a missing one', sameHeaders(null, LAST_QUARTER), false);

process.exit(fail ? 1 : 0);
