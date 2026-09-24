// Reading a Shimano price list into a catalogue.
//
// The supplier's sheet is a picking list. Eighteen rows called "C/SET D/Ace
// R9200 …" are one chainset in eighteen shapes, and a catalogue that lists
// them as eighteen chainsets is one nobody can read. These are the rules that
// decide which rows are shapes of one thing, what that thing is called, and
// which range it belongs to.
//
// The costly failures are all mis-grouping: two products merged into one
// hides a real part behind another's name and price, and a half-made group
// hides the rest of a range. So most of this is about refusing to group.
const { seriesOf, sizeOf, modelCode, rotorParts, modelKey, catalogueName, rebuildSheet } =
  await import('../../scripts/shimano/classify.mjs');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// ── the range a shop asks for ─────────────────────────────────────────────
// Read out of the part number, which is where Shimano states it, and never
// invented: a bottom bracket belongs to no road range.
eq('R92xx is Dura-Ace', seriesOf({ sku: 'FCR9200D26', name: '' }), 'Dura-Ace');
eq('R81xx is Ultegra', seriesOf({ sku: 'FCR8100PE66', name: '' }), 'Ultegra');
eq('a shifter with no prefix still reads',
   seriesOf({ sku: 'R9270DLR', name: '' }), 'Dura-Ace');
eq('a rear mech too', seriesOf({ sku: 'RDR8150', name: '' }), 'Ultegra');
// The Dura-Ace bottom bracket is BB-R9100, and that is what the number says.
eq('a bottom bracket that is part of the range is in it',
   seriesOf({ sku: 'BBR9100B', name: '' }), 'Dura-Ace');
eq('one that is not gets nothing',
   seriesOf({ sku: 'BBUN300B07', name: 'Shimano Bottom Bracket BBUN300B07' }), null);
eq('and neither do brake pads',
   seriesOf({ sku: 'BPG05ARX25', name: 'G05A-RX disc pads and spring' }), null);
eq('the electronics are Di2', seriesOf({ sku: 'EWSD300IL090', name: '' }), 'Di2');
eq('including the charger', seriesOf({ sku: 'EWEC300', name: 'CHARGER' }), 'Di2');
eq('and the battery', seriesOf({ sku: 'BTDN300', name: 'BATT' }), 'Di2');
// The sheet's own bundles pair RT-CL900 with the Dura-Ace build.
eq('rotors follow the build they are sold in',
   seriesOf({ sku: 'RTCL900LJ', name: '' }), 'Dura-Ace');
eq('and the other one', seriesOf({ sku: 'RTCL800LJ', name: '' }), 'Ultegra');
eq('a Deore rotor belongs to no road range',
   seriesOf({ sku: 'SMRT64L', name: '' }), null);

// ── the part number, as Shimano prints it ─────────────────────────────────
eq('a chainset', modelCode('FCR9200D26'), 'FC-R9200');
// The supplier packs speed and ratio into the same string, and a greedy run
// of digits would call the model "R920012130".
eq('a cassette stops at the model', modelCode('CSR920012130'), 'CS-R9200');
eq('a wire', modelCode('EWSD300IL090'), 'EW-SD300');
eq('a shifter has no prefix, so the description is read',
   modelCode('R9270DLR', 'STI LVR STR9270/BRR9270 Di2 hydra LH RR'), 'ST-R9270');
eq('and something unrecognisable is left alone',
   modelCode('WIDGET', 'A widget'), null);

// ── rotors ────────────────────────────────────────────────────────────────
// A rotor states its size nowhere in its name. It is in the part number,
// where the same letters also carry something else.
eq('the letter is the size', rotorParts('RTCL900LJ')?.size, '203mm');
eq('and the rest of the code is kept, because it is another product',
   rotorParts('RTCL900LJ')?.label, '203mm (J)');
eq('so the two lockrings do not collide',
   [rotorParts('RTCL900LE')?.label, rotorParts('RTCL900LI')?.label],
   ['203mm (E)', '203mm (I)']);
eq('a bare code needs no brackets', rotorParts('RTCL300L')?.label, '203mm');
eq('SS is the small one', rotorParts('RTCL900SSE')?.label, '140mm (E)');
// SS before S, or every 140 would read as a 160.
eq('and is not read as S', rotorParts('RTCL900SE')?.label, '160mm (E)');
eq('a size written out is taken as written', rotorParts('RTCL750200E')?.label, '200mm (E)');
// The model digits stop at three, or RT-CL750-200E reads as model "CL7502"
// and sits in a group of its own.
eq('and does not run into the model number', rotorParts('RTCL750200E')?.model, 'RT-CL750');
eq('the model is printed as Shimano prints it', rotorParts('SMRT64L')?.model, 'SM-RT64');
eq('anything that is not a rotor is not read as one', rotorParts('FCR9200D26'), null);

// ── what distinguishes one row from its siblings ──────────────────────────
eq('a chainset is its ratio and its crank',
   sizeOf({ name: 'C/SET D/Ace R9200 52/36 172.5mm', sku: 'FCR9200D26', category: 'chainsets' }),
   '52/36 172.5mm');
eq('a power meter is written differently and reads the same',
   sizeOf({ name: 'Power 52 / 36 - double - 167.5 mm', sku: 'FCR9200PB26', category: 'power-meters' }),
   '52/36 167.5mm');
// "11-34T" is also a hyphenated pair of two-digit numbers, so the cassette is
// asked first and alone: "11/34 11-34T" is a label nobody would recognise.
eq('a cassette is its ratio and nothing else',
   sizeOf({ name: 'CASS D/Ace R9200 12 spd 11-34T', sku: 'CSR920012134', category: 'cassettes' }),
   '11-34T');
// Madison write the twelve-speed ranges without the T. Read the same way, or
// the 105 Di2 and GRX Di2 builds cannot say which cassette they are quoting
// and a family's ranges will not group.
eq('a twelve-speed range with no T on it is still a range',
   sizeOf({ name: '105 R7101 - HYPERGLIDE+ - 12-speed - 11-34', sku: 'CSR710112134', category: 'cassettes' }),
   '11-34');
eq('however the supplier names the family',
   sizeOf({ name: 'Cassettes HG710 - HYPERGLIDE+ - 12-speed - 11-36', sku: 'CSHG71012136', category: 'cassettes' }),
   '11-36');
// Why it is anchored to the end. Unanchored, "CS-HG500 - 11-25" reads as
// "00-11": the tail of the part number and the head of the range.
eq('a part number before the range is not read as the range',
   sizeOf({ name: 'Cassettes - 10-speed CS-HG500 - 11-25', sku: 'CSHG50010125', category: 'cassettes' }),
   '11-25');
// And why it is allowed only on a row already filed as a cassette: a bare
// pair of two-digit numbers is otherwise a weak signal on any part.
eq('a bare pair on something that is not a cassette is not a ratio',
   sizeOf({ name: 'SM-BH90 hose - straight - 10-25', sku: 'SMBH9010', category: 'brake-pads' }),
   null);

eq('a wire is its length',
   sizeOf({ name: 'CABLE E-tube Di2 SD300 1000mm', sku: 'EWSD300IL100', category: 'electronics' }),
   '1000mm');
// Four digits as readily as three. Nothing in either Madison sheet has
// exercised this — September stops at 850mm and July carried only the 900 and
// the 1000 — so the day a 1200 is quoted is the day it would be found out.
eq('a wire longer than a metre is still a length',
   sizeOf({ name: 'E-tube SD300 electric wire - 1200 mm - black', sku: 'EWSD300IL120', category: 'electronics' }),
   '1200mm');
eq('and the longest of them',
   sizeOf({ name: 'E-tube SD300 electric wire - 1400 mm - black', sku: 'EWSD300IL140', category: 'electronics' }),
   '1400mm');

eq('a shifter is which hand it is',
   sizeOf({ name: 'STI LVR STR9270/BRR9270 Di2 hydra LH RR', sku: 'R9270DLR', category: 'shifters' }),
   'Left (rear)');
eq('and the other hand',
   sizeOf({ name: 'STI LVR STR8170/BRR8170 Di2 hydra RH FR', sku: 'R8170DRF', category: 'shifters' }),
   'Right (front)');
eq('a bottom bracket is not a size of anything',
   sizeOf({ name: 'Shimano Bottom Bracket BBUN300B07', sku: 'BBUN300B07', category: 'bottom-brackets' }),
   null);

// ── the key that gathers them ─────────────────────────────────────────────
// The one that matters most: both ranges' power meters are called exactly
// "Power 52 / 36 - double - 170 mm" and differ by £105.
const pmDura = { name: 'Power 52 / 36 - double - 170 mm', sku: 'FCR9200PC26', category: 'power-meters' };
const pmUlt  = { name: 'Power 52 / 36 - double - 170 mm', sku: 'FCR8100PC26', category: 'power-meters' };
eq('two ranges with identical names do not share a key',
   modelKey(pmDura, { series: 'Dura-Ace', size: '52/36 170mm' })
     !== modelKey(pmUlt, { series: 'Ultegra', size: '52/36 170mm' }),
   true);
eq('and the key says which is which',
   modelKey(pmDura, { series: 'Dura-Ace', size: '52/36 170mm' }),
   'DURA-ACE-FC-R9200-POWER-METERS');
// A chainset and a power meter of the same range are different products.
eq('a collection separates them too',
   modelKey({ ...pmDura, category: 'chainsets', sku: 'FCR9200C26' },
            { series: 'Dura-Ace', size: '52/36 170mm' }),
   'DURA-ACE-FC-R9200-CHAINSETS');
eq('a range with no series says so by leaving it out',
   modelKey({ name: '', sku: 'SMRT64L', category: 'rotors' }, { series: null, size: '203mm' }),
   'SM-RT64-ROTORS');
eq('and a row with no size gets no key',
   modelKey({ name: '', sku: 'BBUN300B07', category: 'bottom-brackets' },
            { series: null, size: null }), null);

// ── the name a customer reads ─────────────────────────────────────────────
eq('series, part number, what it is, then which one',
   catalogueName({ name: 'C/SET D/Ace R9200 52/36 172.5mm', sku: 'FCR9200D26', category: 'chainsets' },
                 { series: 'Dura-Ace', size: '52/36 172.5mm' }),
   'Dura-Ace FC-R9200 Chainset 52/36 172.5mm');
// The size stays on the end. The catalogue strips it for the group heading and
// an invoice does not, and a line reading "Dura-Ace FC-R9200 Chainset" tells
// a customer nothing about which of six crank lengths turned up.
eq('the speed comes off the cassette description',
   catalogueName({ name: 'CASS Ultegra R8101 12 spd 11-30T', sku: 'CSR810112130', category: 'cassettes' },
                 { series: 'Ultegra', size: '11-30T' }),
   'Ultegra CS-R8101 12-speed Cassette 11-30T');
eq('a front mech is named as one',
   catalogueName({ name: 'FR MECH D/Ace Di2 R9250 12spd braze', sku: 'FDR9250F', category: 'derailleurs' },
                 { series: 'Dura-Ace', size: null }),
   'Dura-Ace FD-R9250 Front Derailleur');
eq('and a rear one',
   catalogueName({ name: 'RR MECH Ult Di2 R8150 12spd', sku: 'RDR8150', category: 'derailleurs' },
                 { series: 'Ultegra', size: null }),
   'Ultegra RD-R8150 Rear Derailleur');
// Two places knowing the same fact is how "Di2 Di2 Wire" happens.
eq('the series is not said twice',
   catalogueName({ name: 'CABLE E-tube Di2 SD300 900mm', sku: 'EWSD300IL090', category: 'electronics' },
                 { series: 'Di2', size: '900mm' }),
   'Di2 EW-SD300 E-tube Wire 900mm');
eq('a bundle is already named properly and is left alone',
   catalogueName({ name: 'Dura-Ace Di2 R9200 — Standard Build 11-30T',
                   sku: 'BUNDLE-R9200-STD-1130', category: 'groupsets' }, { series: 'Dura-Ace', size: null }),
   'Dura-Ace Di2 R9200 — Standard Build 11-30T');

// ── the whole sheet ───────────────────────────────────────────────────────
const SHEET = [
  { name: 'C/SET D/Ace R9200 52/36 172.5mm', sku: 'FCR9200D26', category: 'chainsets' },
  { name: 'C/SET D/Ace R9200 50/34 175mm', sku: 'FCR9200E04', category: 'chainsets' },
  { name: 'CHAIN XTR/DuraAce 12spd 126L Q/Link', sku: 'CNM9100126Q', category: 'chains' },
  { name: 'Shimano Bottom Bracket BBUN300B07', sku: 'BBUN300B07', category: 'bottom-brackets' },
  { name: 'CASS D/Ace R9200 12 spd 11-30T', sku: 'CSR920012130', category: 'cassettes' },
];
const built = rebuildSheet(SHEET);
const by = (sku) => built.find((r) => r.sku === sku);

eq('every row comes back', built.length, SHEET.length);
eq('a range of two is grouped',
   by('FCR9200D26').model, 'DURA-ACE-FC-R9200-CHAINSETS');
// A group of one is a heading a customer has to click through to reach a
// single product.
eq('a model with one member is not a range', by('CSR920012130').model, null);
eq('and keeps the size on its name', by('CSR920012130').name, 'CASS D/Ace R9200 12 spd 11-30T');
// Thirty bottom brackets rewritten from their part numbers would all come out
// as "BB-UN300 Bottom Bracket": one readable name on thirty products.
eq('an ungrouped row keeps the name the supplier gave it',
   by('BBUN300B07').name, 'Shimano Bottom Bracket BBUN300B07');
eq('but still gets its series where there is one',
   by('CNM9100126Q').series, 'Dura-Ace');
eq('a grouped row is renamed',
   by('FCR9200E04').name, 'Dura-Ace FC-R9200 Chainset 50/34 175mm');
eq('and every member of a group shares its key',
   new Set(built.filter((r) => r.model).map((r) => r.model)).size, 1);

// ── the carton, and the price outside it ──────────────────────────────────
// Read from the supplier's own workbook, which states the outer and two
// loose-unit prices side by side without saying which of the two is ours.
const { readHeader, readSheet, byTheOuterColumn } =
  await import('../../scripts/shimano/outers.mjs');
const { looseTierPrice, separateSizes } = await import('../../scripts/shimano/rebuild.mjs');

// A cut-down Dura-Ace sheet, laid out as the real one is: a label row above
// the headings, then a bare number heading each of the two loose columns.
const OUTER_SHEET = [
  ['', '', '', '', '', '', '', 'Price By the Outer ', 'Outers '],
  ['CODE', 'DESCRIPTION', 'Outer', 'SRP', 1400, 1200, '', '', 'To Order '],
  ['R9270DLR', 'STI LVR', 10, 599.99, 230, 197.15, '', 189.20, ''],
  ['FCR9200PE26', 'Power 52/36', 8, 1199.99, '', '', '', 460, ''],
  ['', '', '', '', '', '', '', '', 'TOTAL'],
];

const head = readHeader(OUTER_SHEET);
eq('the headings are found by name, not by counting columns',
   [head.code, head.outer, head.row], [0, 2, 1]);
eq('and the two loose columns by being the only numbers on that row',
   head.loose, [4, 5]);
eq('the by-the-outer price is labelled a row above', byTheOuterColumn(OUTER_SHEET), 7);

// Which of the two is ours is a commercial fact the sheet does not state, so
// it is named rather than guessed — and the default is the one that cannot
// cost margin if the guess is wrong.
eq('the dearer loose price by default',
   readSheet(OUTER_SHEET)[0], { sku: 'R9270DLR', outer: 10, below: 230, byTheOuter: 189.20 });
eq('and the other one on request',
   readSheet(OUTER_SHEET, { below: 'lower' })[0].below, 197.15);

// A part the supplier prices by the carton and not at all below it. The outer
// still applies; there is simply no second price, and inventing one would be
// inventing a number.
eq('an outer with no loose price keeps the outer and no price',
   readSheet(OUTER_SHEET)[1], { sku: 'FCR9200PE26', outer: 8, below: null, byTheOuter: 460 });
// A totals line has a figure and no code.
eq('and a totals row is not a part', readSheet(OUTER_SHEET).length, 2);

// A sheet with no Outer column is a range sold in ones, and contributes
// nothing rather than defaulting everything to some quantity.
eq('a sheet with no outer column yields nothing',
   readSheet([['Code', 'Cost (no vat)'], ['BBUN300B07', 5.28]]), []);

// ── what a tier pays for one ──────────────────────────────────────────────
// A flat uplift on our own advertised price, not a margin worked back from
// what a single costs the supplier — because we do not buy singles. We buy
// the carton and split it, and the uplift is the charge for splitting it.
eq('a distributor pays five per cent over the carton price',
   Number(looseTierPrice(204.34, 0.05).toFixed(2)), 214.56);
eq('a shop pays ten', Number(looseTierPrice(211.91, 0.10).toFixed(2)), 233.10);
eq('and a team the same as a shop',
   Number(looseTierPrice(223.26, 0.10).toFixed(2)), 245.59);
eq('a row with no advertised price has nothing to uplift',
   looseTierPrice(null, 0.05), null);
eq('and neither does one priced at zero', looseTierPrice(0, 0.05), null);
// The invariant the database refuses to store a violation of: the loose
// price is always the dearer of the two.
eq('the loose price always comes out above the outer price',
   looseTierPrice(204.34, 0.05) > 204.34, true);
eq('no uplift would make them equal, which is allowed but not what we do',
   looseTierPrice(204.34, 0), 204.34);

// ── two sizes of one model that read the same ─────────────────────────────
// The catalogue shows a model once with its sizes underneath, so two rows
// both labelled "46/30 170mm" are a customer picking whichever the screen
// lists first. Madison's list has exactly that: the FC-RX6001 in ten-speed
// and eleven-speed, identical in every other respect.
const text = new Map([
  ['A', '46 / 30 - double - 11-speed - 170 mm'],
  ['B', '46 / 30 - double - 10-speed - 170 mm'],
]);
const clashing = [
  { sku: 'A', model: 'FC-RX6001-CHAINSETS', size: '46/30 170mm' },
  { sku: 'B', model: 'FC-RX6001-CHAINSETS', size: '46/30 170mm' },
];
const outcome = separateSizes(clashing, (r) => text.get(r.sku));
eq('the speed separates them', clashing.map((r) => r.size),
   ['46/30 170mm 11-speed', '46/30 170mm 10-speed']);
eq('and it is reported as what it did',
   outcome.separated.map((s) => [s.model, s.axis, s.count]),
   [['FC-RX6001-CHAINSETS', 'speed', 2]]);
eq('with nothing ungrouped', outcome.ungrouped, []);

// A range whose sizes are already distinct is left exactly alone — the whole
// catalogue does not want "12-speed" appended to catch the one range that
// needs it.
const clean = [
  { sku: 'A', model: 'M', size: '50/34 170mm' },
  { sku: 'B', model: 'M', size: '52/36 170mm' },
];
separateSizes(clean, () => '12-speed');
eq('a range that reads fine is untouched', clean.map((r) => r.size),
   ['50/34 170mm', '52/36 170mm']);

// Every member has to carry the axis, or the labels stop being comparable:
// "46/30 170mm" beside "46/30 170mm 11-speed" reads as one part described
// twice rather than as two parts.
const partial = [
  { sku: 'A', model: 'M', size: 'X' },
  { sku: 'B', model: 'M', size: 'X' },
];
const half = separateSizes(partial, (r) => (r.sku === 'A' ? '11-speed' : 'no axis here'));
eq('an axis only some of them have is not used',
   partial.map((r) => [r.model, r.size]), [[null, null], [null, null]]);
eq('and the range is ungrouped and said out loud',
   half.ungrouped.map((u) => [u.model, u.count]), [['M', 2]]);

// A single chainring is a ring specification as much as a pair is: "40T" and
// "42T" at one crank length are two products, and reading only the length
// gave both the same size.
eq('a single ring counts as a size',
   sizeOf({ name: 'FC-RX8201 40T - single - 12-speed - 170mm', category: 'chainsets' }),
   '40T 170mm');
eq('and a pair still does',
   sizeOf({ name: 'FC-R9200 50 / 34 - double - 170 mm', category: 'chainsets' }),
   '50/34 170mm');

process.exit(fail ? 1 : 0);
