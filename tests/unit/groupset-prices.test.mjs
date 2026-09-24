// What a whole groupset comes to, and which one it is a price for.
//
// The builder sells a groupset as thirteen separate lines so a customer can
// change any of them, which is right for ordering and useless for answering
// "what does a 105 Di2 groupset cost" — the question a shop asks first. This
// adds the parts up from the same sheet the catalogue is imported from.
//
// The failure that matters here is not a wrong sum, which somebody would
// notice. It is a right sum for the wrong build: pickSize answers a miss with
// the first of the list, so a quote comes out under a heading naming a
// specification it is not for. 105 has no 52/36 and GRX no cassette with a T
// on it, so both of them miss the shared preference by default.
const { priceBuild, sizeText } =
  await import('../../scripts/shimano/groupset-prices.mjs');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// ── the size a row reads as ───────────────────────────────────────────────
// A size is written into the Size column only to tell a model's siblings
// apart, so a product that is the only one of its model carries none.
eq('the stated size wins', sizeText({ Size: '11-30T', Name: 'whatever 11-34' }), '11-30T');
eq('a cassette with no siblings reads off its name',
   sizeText({ Size: '', Name: '105 R7101 - HYPERGLIDE+ - 12-speed - 11-34' }), '11-34');
eq('and the other family',
   sizeText({ Size: '', Name: 'Cassettes HG710 - HYPERGLIDE+ - 12-speed - 11-36' }), '11-36');
eq('a chainset is not a ratio',
   sizeText({ Size: '', Name: 'FC-RX8202 Chainset 48/31 172.5mm' }), '');

// ── a build, priced ───────────────────────────────────────────────────────
// Two of everything the builder offers a choice on, so a wrong pick is a
// different number rather than the same one.
const rows = [
  { SKU: 'R7170DLR', Name: '105 ST-R7170 left rear', Size: '', Distributor: '100.00' },
  { SKU: 'R7170DRF', Name: '105 ST-R7170 right front', Size: '', Distributor: '100.00' },
  { SKU: 'RDR7150',  Name: '105 Di2 R7150', Size: '', Distributor: '90.00' },
  { SKU: 'FDR7150F', Name: '105 FD-R7150 Di2 - braze-on', Size: '', Distributor: '40.00' },
  { SKU: 'BTDN300',  Name: 'Di2 battery', Size: '', Distributor: '50.00' },
  { SKU: 'EWEC300',  Name: 'Charger', Size: '', Distributor: '10.00' },
  { SKU: 'FCR7100C04', Name: 'FC-R7100 Chainset 50/34 170mm', Size: '50/34 170mm', Distributor: '50.00' },
  { SKU: 'FCR7100D04', Name: 'FC-R7100 Chainset 50/34 172.5mm', Size: '50/34 172.5mm', Distributor: '55.00' },
  { SKU: 'CSR710112134', Name: '105 R7101 - HYPERGLIDE+ - 12-speed - 11-34', Size: '', Distributor: '21.00' },
  { SKU: 'CSHG71012136', Name: 'Cassettes HG710 - HYPERGLIDE+ - 12-speed - 11-36', Size: '', Distributor: '30.00' },
  { SKU: 'CNM7100126Q', Name: 'CN-M7100 SLX 12-speed', Size: '', Distributor: '10.00' },
  { SKU: 'RTCL700SI',  Name: 'RT-CL700 Disc Rotor 160mm (I)', Size: '160mm (I)', Distributor: '16.00' },
  { SKU: 'RTCL700SSI', Name: 'RT-CL700 Disc Rotor 140mm (I)', Size: '140mm (I)', Distributor: '14.00' },
  { SKU: 'EWSD300IL055', Name: 'Di2 EW-SD300 E-tube Wire 550mm', Size: '550mm', Distributor: '10.00' },
];

const build105 = {
  name: '105 Di2 R7170', power: false,
  parts: ['R7170DLR', 'R7170DRF', 'RDR7150', 'FDR7150F', 'BTDN300', 'EWEC300'],
  chainset: /^FCR7100(?!P)/, cassette: /^(CSR7101|CSHG710)/,
  chain: /^CNM7100/, rotor: /^RTCL700/,
  prefer: { chainset: '50/34 172.5mm', cassette: '11-34' },
};

const quoted = priceBuild(rows, build105);
eq('every step contributes a line', quoted.chosen.length, 13);
eq('nothing it asked for was missing', quoted.missed, []);
// 390 fixed + 55 chainset + 21 cassette + 10 chain + 16 + 14 rotors + 2 × 10 wires.
eq('and the total is the parts', quoted.total('Distributor'), 526);

// The bug this guards. Ask for the road specification on a 105 build and
// nothing answers it, so the first of each list is quoted instead: the 170mm
// crank and the 11-36. Same shape of output, different groupset.
const wrong = priceBuild(rows, { ...build105, prefer: undefined });
eq('a preference nothing answers is reported, not swallowed',
   wrong.missed.sort(), ['11-30T', '52/36 172.5mm']);
eq('the fallback is still a complete quote', wrong.chosen.length, 13);
eq('but it is a quote for another build', wrong.total('Distributor') === 526, false);

// ── the swing ─────────────────────────────────────────────────────────────
// A quote built on the cheapest of everything is a quote somebody will be
// held to, so the range is printed under the headline.
const [lo, hi] = quoted.swing('Distributor');
// Cheapest: 170mm crank, 11-34 cassette. Dearest: 172.5mm, 11-36.
eq('the floor is the cheapest of every choice', lo, 390 + 50 + 21 + 10 + 28 + 20);
eq('and the ceiling the dearest', hi, 390 + 55 + 30 + 10 + 32 + 20);
eq('the quote sits inside its own range', lo <= 526 && 526 <= hi, true);

// A rotor's size reads "160mm (I)" — the bracket is the lockring, which is
// part of the product and not part of the size anybody asks for. An exact
// match finds nothing and used to fall through to the first rotor in the
// list, quietly quoting two fronts and no rear.
const rotors = quoted.chosen.filter((r) => r.SKU.startsWith('RTCL700'));
eq('the front and rear rotors are different rotors',
   rotors.map((r) => r.SKU), ['RTCL700SI', 'RTCL700SSI']);

process.exit(fail ? 1 : 0);
