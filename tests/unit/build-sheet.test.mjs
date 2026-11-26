// The groupset spec on a packing list: every part of the groupset, with the
// size that matters pulled out, and "not included" where the order has none.
const { buildSheets, wantsBuildSheet, specValue } =
  await import('../../.test-build/orders/build-sheet.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

const ROTORS = ['RTCL900SS', 'RTCL900S'];
const WIRES = ['EWSD300-900', 'EWSD300-1000', 'EWSD300-1200'];
const step = (name, sort, skus, extra = {}) => ({ name, sort, skus, ...extra });
const DA = {
  name: 'Dura-Ace R9200 Di2',
  steps: [
    step('Left shifter', 0, ['STR9270L']),
    step('Right shifter', 1, ['STR9270R']),
    step('Rear derailleur', 2, ['RDR9250']),
    step('Chainset', 4, ['FCR9200-170-5236'], { axis1_name: 'Crank length', axis2_name: 'Chainring' }),
    step('Cassette', 5, ['CSR9200-1130', 'CSR9200-1134'], { spec: 'Cassette' }),
    step('Chain', 6, ['CNM9100']),
    step('Front rotor', 7, ROTORS, { spec: 'Rotor size' }),
    step('Rear rotor', 8, ROTORS, { spec: 'Rotor size' }),
    step('First Di2 wire', 11, WIRES, { spec: 'Wire length' }),
    step('Second Di2 wire', 12, WIRES, { spec: 'Wire length' }),
  ],
};
const ULT = { name: 'Ultegra R8100 Di2', steps: [
  step('Left shifter', 0, ['STR8170L']), step('Chain', 6, ['CNM9100']),
  step('First Di2 wire', 11, WIRES, { spec: 'Wire length' }),
] };

eq('from SO-1280 on', [wantsBuildSheet('SO-1279'), wantsBuildSheet('SO-1280'), wantsBuildSheet('SO-1301')], [false, true, true]);
eq('cassette spec', specValue('CS-R9200 12sp cassette 11-34T', 'Cassette'), '11-34T');
eq('rotor from code', specValue('RT-CL900 RTCL900SS', 'Rotor size'), '140mm');
eq('wire length', specValue('EW-SD300 Di2 wire 1200mm', 'Wire length'), '1200mm');

const lines = [
  { sku: 'STR9270L', name: 'ST-R9270 left', qty: 2 },
  { sku: 'STR9270R', name: 'ST-R9270 right', qty: 2 },
  { sku: 'RDR9250', name: 'RD-R9250', qty: 2 },
  { sku: 'FCR9200-170-5236', name: 'FC-R9200 170mm 52-36', qty: 2 },
  { sku: 'CSR9200-1134', name: 'CS-R9200 11-34T', qty: 2 },
  { sku: 'CNM9100', name: 'CN-M9100 chain', qty: 2 },
  { sku: 'EWSD300-900', name: 'EW-SD300 900mm', qty: 2 },
  { sku: 'EWSD300-1200', name: 'EW-SD300 1200mm', qty: 2 },
];
const [sheet, ...more] = buildSheets(lines, [ULT, DA]);
eq('one groupset found, the one answering most', [sheet.group, more.length], ['Dura-Ace R9200 Di2', 0]);
const row = (p) => sheet.rows.find((r) => r.part === p);
eq('front and rear rotor print as one row', sheet.rows.map((r) => r.part).includes('Rotors'), true);
eq('no rotors says so', row('Rotors').items, []);
eq('cassette size shown', row('Cassette').items[0].detail, '11-34T — CS-R9200 11-34T');
eq('chainset length and rings', row('Chainset').items[0].detail, '170mm · 52/36 — FC-R9200 170mm 52-36');
eq('both wire lengths under one row', row('Di2 wires').items.map((i) => i.detail.split(' ')[0]), ['900mm', '1200mm']);
eq('a lone cassette is not a groupset', buildSheets([lines[4]], [DA]), []);

process.exit(fail ? 1 : 0);
