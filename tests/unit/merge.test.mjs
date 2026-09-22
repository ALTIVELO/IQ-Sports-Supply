// Folding a workbook into one row per SKU.
//
// Everything downstream of this believes what it is handed: the preview
// counts it, the apply writes it. So the failures worth testing are the
// silent ones — a figure that arrives on the row and does not come out the
// other side, and a figure that is wrong in a way the database will refuse
// long after the products have been created.
const { mergeSheets } = await import('../../.test-build/import/merge.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};
const row = (over) => ({
  sku: 'X', name: 'A part', brand: 'Shimano',
  prices: {}, breakPrices: {}, ...over,
});
const one = (r) => mergeSheets([{ rows: [r] }]);
const reasons = (r) => one(r).invalid.map((i) => i.reason);

// ── the figures survive one sheet ─────────────────────────────────────────
const plain = one(row({ moq: 10, prices: { t1: 204.34 }, breakPrices: { t1: 248.40 } }));
eq('an outer comes through', plain.rows[0].moq, 10);
eq('and the price for fewer than one', plain.rows[0].breakPrices, { t1: 248.40 });
eq('with nothing to complain about', plain.invalid, []);

// ── and survive a merge ───────────────────────────────────────────────────
// The tab-per-tier shape: one SKU across two sheets, each carrying part of
// the picture. Before this was tested, the second sheet's outer and loose
// prices were dropped on the floor — the row was there, so nothing looked
// wrong, and the products imported at an outer of one.
const merged = mergeSheets([
  { rows: [row({ prices: { t1: 204.34 }, breakPrices: { t1: 248.40 }, moq: 10 })] },
  { rows: [row({ prices: { t2: 211.91 }, breakPrices: { t2: 233.10 } })] },
]);
eq('one SKU across two sheets is one row', merged.rows.length, 1);
eq('with both tiers priced', merged.rows[0].prices, { t1: 204.34, t2: 211.91 });
eq('and both loose prices kept', merged.rows[0].breakPrices, { t1: 248.40, t2: 233.10 });
eq('and the outer from whichever sheet carried it', merged.rows[0].moq, 10);

// The other way round: the outer arrives on the second sheet.
const late = mergeSheets([
  { rows: [row({ prices: { t1: 204.34 } })] },
  { rows: [row({ prices: { t2: 211.91 }, moq: 10, breakCost: 230 })] },
]);
eq('an outer on the later sheet is not lost', late.rows[0].moq, 10);
eq('nor is a loose cost', late.rows[0].breakCost, 230);

// ── figures that cannot be read ───────────────────────────────────────────
// NaN is what a cell reading "POA" becomes. Unchecked it reaches the database
// and fails the run on a type error with no row number attached.
eq('an unreadable loose price is a bad row',
   reasons(row({ prices: { t1: 10 }, breakPrices: { t1: NaN } })),
   ['Unreadable under-outer price for X']);
eq('and so is an unreadable loose cost',
   reasons(row({ cost: 5, breakCost: NaN })), ['Unreadable under-outer cost for X']);
eq('and an outer that is not a quantity',
   reasons(row({ moq: NaN })), ['"NaN" is not an outer quantity for X']);
eq('an outer of nought is not one either',
   reasons(row({ moq: 0 })), ['"0" is not an outer quantity for X']);
eq('and a negative loose price is refused like a negative price',
   reasons(row({ prices: { t1: 10 }, breakPrices: { t1: -5 } })).length, 2);

// ── the swapped column ────────────────────────────────────────────────────
// The expensive one. Both numbers are plausible in either column, so read the
// wrong way round every carton sells at the loose price and nothing
// downstream questions it. The database refuses it, but by then the products
// exist and the error names a constraint.
eq('a loose price under the carton price is caught here, not by the database',
   reasons(row({ prices: { t1: 248.40 }, breakPrices: { t1: 204.34 } })),
   ['X: 204.34 under the outer is less than 248.40 by the outer — '
    + 'the two columns look swapped']);
eq('the same price either way is ordinary',
   reasons(row({ prices: { t1: 204.34 }, breakPrices: { t1: 204.34 } })), []);
// Nothing to compare against is not a contradiction.
eq('a loose price on an unpriced tier is not a swap',
   reasons(row({ prices: {}, breakPrices: { t1: 204.34 } })), []);

// ── what the preview is told ──────────────────────────────────────────────
const notes = (rows) => mergeSheets([{ rows }]).notes.join(' | ');
const said = notes([
  row({ sku: 'A', moq: 10, prices: { t1: 100 }, breakPrices: { t1: 105 } }),
  row({ sku: 'B', moq: 8, prices: { t1: 100 } }),
  row({ sku: 'C', prices: { t1: 100 } }),
]);
eq('the preview is told how many rows set an outer',
   said.includes('2 rows set an outer'), true);
eq('and how many carry a price for fewer than one',
   said.includes('1 carries a price for fewer than one'), true);
eq('and that an outer without one is not a failure',
   said.includes('1 of those set an outer with no price for fewer than one'), true);

// A loose price for a tier the file does not price is dropped on apply. Said
// out loud, because it is almost always a column pointed at the wrong tier.
eq('an orphaned loose price is reported rather than dropped in silence',
   notes([row({ prices: { t1: 100 }, breakPrices: { t2: 120 } })])
     .includes('do not otherwise price') || notes([row({ prices: { t1: 100 }, breakPrices: { t2: 120 } })])
     .includes('does not otherwise price'), true);
eq('and a file with no outers says nothing about them',
   notes([row({ prices: { t1: 100 } })]), '');

process.exit(fail ? 1 : 0);
