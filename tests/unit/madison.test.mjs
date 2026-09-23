// Reading Madison's master Shimano list.
//
// The workbook is a printed catalogue: one column block, a section heading
// every few rows with no code against it, and descriptions that only mean
// anything underneath one. "50 / 34 - double - 170 mm" is a chainset solely
// because of the heading four rows above it.
//
// The costly failures here are all about losing a product: a description read
// without its heading, a part listed twice under two headings counted as two,
// and a section read off a model heading instead of a section one — which
// filed every Dura-Ace shifter under electronics, because its heading
// mentions wires.
const { tidyKeys, tidyHeading, productName, namesAModel, sectionCategory, readMaster } =
  await import('../../scripts/shimano/madison.mjs');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// ── the column that is one space wide ─────────────────────────────────────
// The sheet's last heading is "IQ Sports Price " with a trailing space,
// invisible in Excel. Read by the name without it, every row came back
// unpriced — 351 parts reported as "not priced yet", which is plausible
// enough to have been believed.
eq('a heading with a trailing space is still that heading',
   tidyKeys({ 'IQ Sports Price ': 12.3, 'SRP': 59.99 }),
   { 'IQ Sports Price': 12.3, SRP: 59.99 });

// ── what to call a part ───────────────────────────────────────────────────
// A description naming its own range is the supplier's own words, kept.
eq('a description that names its range stands alone',
   productName('Dura-Ace BB-R9100 - English thread cups', 'HollowTech II bottom bracket cups'),
   'Dura-Ace BB-R9100 - English thread cups');
// One that does not is a variant of the heading above it.
eq('and one that does not takes the heading with it',
   productName('50 / 34 - double - 170 mm', 'Dura-Ace - FC-R9200 (please also order bottom bracket cups)'),
   'Dura-Ace - FC-R9200 50 / 34 - double - 170 mm');
// The instruction to the buyer is not part of a product name on an invoice.
eq('an aside to the reader is not part of the name',
   tidyHeading('Dura-Ace - FC-R9200 (please also order bottom bracket cups)'),
   'Dura-Ace - FC-R9200');
eq('a heading with nothing under it is the name',
   productName('', 'Chains'), 'Chains');
eq('and the heading is not said twice',
   productName('Chains 12-speed', 'Chains'), 'Chains 12-speed');

// ── a section heading, or a model heading ─────────────────────────────────
// A Shimano model code is three or four digits with at most two letters in
// front. Two digits would catch "Cassettes - 11-speed" and "49 mm Drop".
eq('a model heading names a model', namesAModel('Dura-Ace R9270 Di2 - 12-speed'), true);
eq('however it is written', namesAModel('GRX RX820 - without bottom bracket'), true);
eq('a section heading does not', namesAModel('Gear shifters - STI'), false);
eq('a speed is not a model', namesAModel('Cassettes - 11-speed'), false);
eq('nor is a lever drop', namesAModel('49 mm Drop'), false);
eq('nor a wheel size', namesAModel('700C - clincher - for disc brake'), false);

// ── what a part is, from the section it sat under ─────────────────────────
// Nearest first, skipping the model headings, because a block runs
// "Cassettes" then "Dura-Ace R9200 12-speed" then the rows.
eq('the nearest section heading wins',
   sectionCategory(['Cassettes', 'Dura-Ace R9200 12-speed']), 'cassettes');
// The case that filed shifters under electronics: the model heading mentions
// the wires the shifter takes.
eq('a model heading is not read as a section',
   sectionCategory(['Gear shifters - STI',
                    'Dura-Ace R9270 Di2 - 12-speed - E-tube fit for SD300 wires']),
   'shifters');
// "Chainsets - HollowTech II" names the bottom bracket standard it fits.
eq('a chainset heading is not a bottom bracket',
   sectionCategory(['Chainsets - HollowTech II']), 'chainsets');
eq('and a bottom bracket heading still is',
   sectionCategory(['HollowTech II bottom bracket cups']), 'bottom-brackets');
// A Di2 junction box that lives at the bottom bracket is electronics.
eq('a bottom bracket junction is a junction',
   sectionCategory(['E-tube SEIS Di2 bottom bracket junctions']), 'electronics');
// A wheel heading routinely says which brake it is for.
eq('a wheel is not a brake',
   sectionCategory(['Wheels', '700C - clincher - for disc brake']), 'wheels');
eq('a rotor is not a brake either',
   sectionCategory(['Disc brake rotors']), 'rotors');
eq('but a calliper is', sectionCategory(['Disc brake callipers']), 'brakes');
eq('and a brake lever is', sectionCategory(['Hydraulic - disc brake levers']), 'brakes');
eq('while a shift lever is a shifter',
   sectionCategory(['Road shift levers and STI']), 'shifters');
// A sub-heading that says nothing falls through to the one above it.
eq('a sub-heading with no kind in it falls through',
   sectionCategory(['Brake callipers', '49 mm Drop']), 'brakes');
eq('and nothing at all is null', sectionCategory(['Double']), null);

// ── reading the sheet ─────────────────────────────────────────────────────
const TIERS = [{ name: 'Distributor', rate: 0.08 }, { name: 'Shop', rate: 0.12 }];
const sheet = [
  { Description: 'Cassettes', 'Madison Code': '' },
  { Description: 'Dura-Ace R9200 12-speed', 'Madison Code': '' },
  { Description: '11-30T', 'Madison Code': 'CSR920012130', SRP: 329.99, 'IQ Sports Price ': 100 },
  { Description: 'Pedals', 'Madison Code': '' },
  { Description: 'Dura-Ace R9100 Carbon', 'Madison Code': 'PDR9100', SRP: 249.99, 'IQ Sports Price ': 80 },
  // The same pedal again, under another heading. One part, not two.
  { Description: 'Road pedals', 'Madison Code': '' },
  { Description: 'Dura-Ace R9100 Carbon', 'Madison Code': 'PDR9100', SRP: 249.99, 'IQ Sports Price ': 80 },
  // Madison have not priced this one yet.
  { Description: 'C60 Carbon clincher', 'Madison Code': 'WHR9370C60TLF', SRP: 1099.99, 'IQ Sports Price ': '' },
];
const read = readMaster(sheet, { buffer: 0.05, tiers: TIERS }, () => null);

eq('one row per part', read.rows.length, 3);
eq('a part listed twice is folded in, not counted twice', read.repeated, ['PDR9100']);
eq('and no disagreement to report', read.conflicting, []);

const cassette = read.rows.find((r) => r.SKU === 'CSR920012130');
// The quote plus the margin of error Madison asked us to leave, then the
// standard rates on the buffered figure — buffer first, tiers after.
eq('the cost is the quote plus the buffer', cassette['Our cost'], '105.00');
eq('and each tier is the standard rate on that',
   [cassette.Distributor, cassette.Shop], ['113.40', '117.60']);
eq('the RRP is the supplier\'s own', cassette.Retail, '329.99');
eq('and the heading names it',
   cassette.Name, 'Dura-Ace R9200 12-speed 11-30T');

// A part with no quote gets no cost and no trade price. It still exists, with
// its RRP, and simply cannot be sold until one arrives — which is better than
// pricing it at a guess or dropping it from the catalogue.
const wheel = read.rows.find((r) => r.SKU === 'WHR9370C60TLF');
eq('an unpriced part keeps its RRP', wheel.Retail, '1099.99');
eq('and has no cost', wheel['Our cost'], '');
eq('and no trade price', [wheel.Distributor, wheel.Shop], ['', '']);

// The same code at two different prices is not the same part.
const conflict = readMaster([
  { Description: 'A', 'Madison Code': 'X', SRP: 10, 'IQ Sports Price ': 5 },
  { Description: 'A', 'Madison Code': 'X', SRP: 10, 'IQ Sports Price ': 6 },
], { buffer: 0, tiers: [] }, () => null);
eq('a repeat at a different price is reported', conflict.conflicting, ['X']);

process.exit(fail ? 1 : 0);
