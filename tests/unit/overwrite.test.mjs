// What a re-issued price list is allowed to restate about a SKU we hold.
//
// The whole rule is the difference between a column that is not on the sheet
// and a column that is there with an empty cell. Getting that wrong in one
// direction leaves a catalogue nobody can tidy without re-keying it; in the
// other it empties the catalogue of photographs on an import that looked like
// it only changed prices.
const { restatements, restatementPatch, restatementTally, restatementLabel } =
  await import('../../.test-build/import/overwrite.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const NOW = {
  name: 'C/SET D/Ace R9200 52/36 172.5mm',
  brand: 'Shimano', series: null,
  image_url: 'https://cdn.example/old.jpg',
  price_note: null, category_id: 'cat-chainsets',
  variant_group: null, variant_label: null,
  // Sold in ones, which is what most of a catalogue is and what every
  // product was before outers existed.
  moq: 1,
};
const keep = { clearBlanks: false };
const wipe = { clearBlanks: true };
const fields = (r) => r.map((c) => c.field).sort();

// ── a column that is not on the sheet ─────────────────────────────────────
// The commonest case by far: a supplier's list has a name and prices and
// nothing else, and must not be read as an instruction about anything else.
eq('a sheet that says nothing changes nothing',
   restatements({ sku: 'X', prices: {} }, NOW, keep), []);
eq('and still nothing when blanks are being taken as deletions',
   restatements({ sku: 'X', prices: {} }, NOW, wipe), []);

// ── a column with something in it ─────────────────────────────────────────
eq('a new name replaces the old one',
   restatements({ sku: 'X', name: 'Dura-Ace FC-R9200 Chainset 52/36 172.5mm', prices: {} },
                NOW, keep).map((c) => [c.field, c.to]),
   [['name', 'Dura-Ace FC-R9200 Chainset 52/36 172.5mm']]);
eq('the same name again is not a change',
   restatements({ sku: 'X', name: NOW.name, prices: {} }, NOW, keep), []);
eq('and whitespace around it is not a change either',
   restatements({ sku: 'X', name: `  ${NOW.name}  `, prices: {} }, NOW, keep), []);

eq('a series arrives where there was none',
   restatements({ sku: 'X', series: 'Dura-Ace', prices: {} }, NOW, keep)
     .map((c) => [c.from, c.to]),
   [[null, 'Dura-Ace']]);
eq('a brand is restated like anything else',
   restatements({ sku: 'X', brand: 'SHIMANO', prices: {} }, NOW, keep)
     .map((c) => c.field), ['brand']);

// ── a column with an empty cell ───────────────────────────────────────────
// The rebuilt Shimano sheet carries an empty Image column on all 188 rows.
eq('a blank is silence by default',
   restatements({ sku: 'X', image_url: '', brand: '', prices: {} }, NOW, keep), []);
eq('and an instruction when the import was told to take it that way',
   fields(restatements({ sku: 'X', image_url: '', brand: '', prices: {} }, NOW, wipe)),
   ['brand', 'image']);
eq('clearing something already empty is not a change',
   restatements({ sku: 'X', series: '', prices: {} }, NOW, wipe), []);
// A product with no name cannot be picked off a shelf or read on an invoice.
eq('a name is never cleared, however the import is set',
   restatements({ sku: 'X', name: '', prices: {} }, NOW, wipe), []);

// ── an image column holding something that is not an image ────────────────
// A sheet often carries a filename here, which renders as a broken picture.
eq('a filename is not an instruction',
   restatements({ sku: 'X', image_url: 'chainset.jpg', prices: {} }, NOW, keep), []);
eq('a URL is', restatements({ sku: 'X', image_url: 'https://cdn.example/new.jpg', prices: {} },
                            NOW, keep).map((c) => c.to),
   ['https://cdn.example/new.jpg']);

// ── the collection ────────────────────────────────────────────────────────
eq('a collection the sheet names is filed under',
   restatements({ sku: 'X', category: 'rotors', prices: {} }, NOW,
                { clearBlanks: false, categoryId: 'cat-rotors' })
     .map((c) => [c.field, c.to]),
   [['collection', 'cat-rotors']]);
// Filing a product under nothing because of a typo is worse than leaving it.
eq('a collection we do not have is left alone',
   restatements({ sku: 'X', category: 'rotorz', prices: {} }, NOW,
                { clearBlanks: false, categoryId: undefined }), []);
eq('the same collection again is not a change',
   restatements({ sku: 'X', category: 'chainsets', prices: {} }, NOW,
                { clearBlanks: false, categoryId: 'cat-chainsets' }), []);

// ── the model and the size ────────────────────────────────────────────────
const SIZED = { ...NOW, variant_group: 'OLD-GROUP', variant_label: '52/36 172.5mm' };

eq('a model and a size arrive together',
   restatements({ sku: 'X', variant_group: 'DURA-ACE-FC-R9200-CHAINSETS',
                  variant_label: '52/36 172.5mm', prices: {} }, NOW, keep)
     .map((c) => [c.field, c.to]),
   [['size', 'DURA-ACE-FC-R9200-CHAINSETS · 52/36 172.5mm']]);
// Half a pair files a product under a model with no size, or gives it a size
// belonging to no model — and the second collides with every other sizeless
// row in the same group.
eq('a model with no size does nothing',
   restatements({ sku: 'X', variant_group: 'G', variant_label: '', prices: {} }, NOW, keep), []);
eq('and a size with no model does nothing',
   restatements({ sku: 'X', variant_group: '', variant_label: 'M', prices: {} }, NOW, keep), []);
eq('a product leaves its range whole',
   restatements({ sku: 'X', variant_group: '', variant_label: '', prices: {} }, SIZED, wipe)
     .map((c) => [c.field, c.from, c.to]),
   [['size', 'OLD-GROUP · 52/36 172.5mm', null]]);
eq('and not by default',
   restatements({ sku: 'X', variant_group: '', variant_label: '', prices: {} }, SIZED, keep), []);
eq('the same model and size again is not a change',
   restatements({ sku: 'X', variant_group: 'OLD-GROUP', variant_label: '52/36 172.5mm',
                  prices: {} }, SIZED, keep), []);

// ── the patch the row actually gets ───────────────────────────────────────
eq('every restatement lands in one update',
   restatementPatch(restatements(
     { sku: 'X', name: 'New name', series: 'Ultegra',
       variant_group: 'G', variant_label: 'M', prices: {} }, NOW, keep)),
   { name: 'New name', series: 'Ultegra', variant_group: 'G', variant_label: 'M' });
eq('clearing a size clears the order it sat in too',
   restatementPatch(restatements(
     { sku: 'X', variant_group: '', variant_label: '', prices: {} }, SIZED, wipe)),
   { variant_group: null, variant_label: null, variant_sort: null });
eq('and nothing to restate is an empty patch',
   restatementPatch([]), {});

// ── what the preview reports ──────────────────────────────────────────────
const tally = restatementTally([
  restatements({ sku: 'A', name: 'One', series: 'Dura-Ace', prices: {} }, NOW, keep),
  restatements({ sku: 'B', name: 'Two', prices: {} }, NOW, keep),
  restatements({ sku: 'C', prices: {} }, NOW, keep),
]);
eq('the commonest column first', tally, [{ field: 'name', rows: 2 }, { field: 'series', rows: 1 }]);
eq('and a quiet import reports nothing', restatementTally([[], []]), []);

// "series" is already plural, and adding an s to it gave "108 seriess".
eq('a column with an ordinary plural gets one', restatementLabel('name', 188), 'names');
eq('one that is already plural does not', restatementLabel('series', 108), 'series');
eq('a two-word column pluralises its last word',
   restatementLabel('price note', 3), 'price notes');
eq('and one row is singular', restatementLabel('collection', 1), 'collection');
eq('however awkward the word', restatementLabel('series', 1), 'series');

// ── the outer ─────────────────────────────────────────────────────────────
// A number, but the same three states as everything else: a sheet with no
// Outer column says nothing about how a part is boxed.
eq('a sheet with no outer column leaves the outer alone',
   restatements({ sku: 'X', prices: {} }, NOW, keep), []);
eq('an outer of ten against a part sold in ones is a change',
   restatements({ sku: 'X', moq: 10, prices: {} }, NOW, keep)
     .map((c) => [c.field, c.patch, c.from, c.to]),
   [['outer', { moq: 10 }, '1', '10']]);
eq('and the same outer again is not',
   restatements({ sku: 'X', moq: 10, prices: {} }, { ...NOW, moq: 10 }, keep), []);
eq('one against a part already sold in ones is not either',
   restatements({ sku: 'X', moq: 1, prices: {} }, NOW, keep), []);

// Blank is silence unless the import was told otherwise — the same rule the
// image column follows, and for the same reason: a price list routinely
// leaves a column empty on rows it has nothing to say about.
eq('a blank outer is silence by default',
   restatements({ sku: 'X', moq: NaN, prices: {} }, { ...NOW, moq: 10 }, keep), []);
// Cleared means one, not nothing: every part has a minimum, and for most of
// them it is one.
eq('and clearing it puts the part back to ones',
   restatements({ sku: 'X', moq: NaN, prices: {} }, { ...NOW, moq: 10 }, wipe)
     .map((c) => [c.field, c.patch, c.to]),
   [['outer', { moq: 1 }, null]]);
eq('an outer of ten is ten outers',
   restatementLabel('outer', 10), 'outers');

process.exit(fail ? 1 : 0);
