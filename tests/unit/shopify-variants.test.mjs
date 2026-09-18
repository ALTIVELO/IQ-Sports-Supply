// Reading a Shopify product export into a catalogue.
//
// Shopify writes a product across several rows: the first says what it is, and
// every row after it is bare except the handle, the option that distinguishes
// it, its SKU and its price. Eighteen rows of wheelsets, six of which say
// anything. Flattening that wrong loses a product or invents one, so most of
// this is about what the bare rows inherit and what they do not.
const { flattenShopify, optionLabel, seriesOf, brandOf } =
  await import('../../scripts/vision/classify.mjs');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

// ── what to call an option ────────────────────────────────────────────────
// "Shimano" on its own is a brand — and this is a Vision wheel.
eq('a freehub says it is a freehub', optionLabel('Freehub', 'Shimano'), 'Shimano freehub');
eq('whichever one it is', optionLabel('Freehub', 'SRAM XDR'), 'SRAM XDR freehub');
// Saying it twice reads as a typo.
eq('and not twice, where the value already says it',
   optionLabel('Freehub', 'Shimano freehub'), 'Shimano freehub');
// "56cm size" is nobody's idea of a size.
eq('a size is left to speak for itself', optionLabel('Size', '56cm'), '56cm');
eq('however the axis is worded', optionLabel('Rotor size', '160mm'), '160mm');
eq('and so is a colour', optionLabel('Colour', 'Black'), 'Black');
eq('an axis with no name is just the value', optionLabel('', 'Solo'), 'Solo');
eq('and no value at all is nothing', optionLabel('Freehub', '  '), null);

// ── the range a wheel belongs to ──────────────────────────────────────────
// The longer names are asked first: "Metron 45 SL" contains "Metron".
eq('the racing series', seriesOf('Vision Metron 45 RS Carbon Wheelset'), 'Metron RS');
eq('and the lighter one', seriesOf('Vision Metron 60 SL Carbon Wheelset'), 'Metron SL');
eq('SC is its own range', seriesOf('Vision SC 45 SL Carbon Wheelset'), 'SC');
eq('and something we have no rule for gets none',
   seriesOf('Vision Handlebar 42cm'), null);

// ── the brand, out of a vendor field ──────────────────────────────────────
// A catalogue filing half its wheels under "Vision" and half under
// "Vision (FSA)" has two brands where there is one.
eq('who owns the brand is not part of its name', brandOf('Vision (FSA)'), 'Vision');
eq('a plain vendor is left alone', brandOf('Shimano'), 'Shimano');

// ── flattening ────────────────────────────────────────────────────────────
const SHEET = [
  { Handle: 'vision-sc-45-wheelset', Title: 'Vision SC 45 SL Carbon Wheelset',
    Vendor: 'Vision (FSA)', 'Option1 Name': 'Freehub', 'Option1 Value': 'Shimano',
    'Variant SKU': 'VIS-SC45-SHI', 'Variant Price': '478.80',
    'Image Src': 'https://cdn.example/sc45.png' },
  { Handle: 'vision-sc-45-wheelset', Title: '', Vendor: '',
    'Option1 Name': '', 'Option1 Value': 'SRAM XDR',
    'Variant SKU': 'VIS-SC45-XDR', 'Variant Price': '478.80', 'Image Src': '' },
  { Handle: 'vision-bottle', Title: 'Vision Bottle', Vendor: 'Vision (FSA)',
    'Option1 Name': 'Title', 'Option1 Value': 'Default Title',
    'Variant SKU': 'VIS-BOTTLE', 'Variant Price': '6.00',
    'Image Src': 'https://cdn.example/bottle.png' },
];
const out = flattenShopify(SHEET);
const bySku = (sku) => out.find((r) => r.sku === sku);

eq('one row per orderable SKU', out.map((r) => r.sku),
   ['VIS-SC45-SHI', 'VIS-SC45-XDR', 'VIS-BOTTLE']);

// The bare row carries nothing but its option and its SKU.
eq('a bare row inherits its title', bySku('VIS-SC45-XDR').title,
   'Vision SC 45 SL Carbon Wheelset');
eq('its brand', bySku('VIS-SC45-XDR').brand, 'Vision');
eq('its series', bySku('VIS-SC45-XDR').series, 'SC');
// Shopify hangs the photograph off the first row, so every variant of one
// wheelset would otherwise have none.
eq('and the photograph', bySku('VIS-SC45-XDR').image, 'https://cdn.example/sc45.png');
// The axis is on the first row too.
eq('the axis name comes from the head row as well',
   bySku('VIS-SC45-XDR').size, 'SRAM XDR freehub');

// The size goes on the end of the name: the catalogue strips it for the group
// heading and an invoice keeps it, and a line reading only "Vision SC 45 SL
// Carbon Wheelset" does not say which freehub turned up.
eq('the option is on the end of the name', bySku('VIS-SC45-SHI').name,
   'Vision SC 45 SL Carbon Wheelset — Shimano freehub');
eq('and both of them share one model',
   [bySku('VIS-SC45-SHI').model, bySku('VIS-SC45-XDR').model],
   ['VISION-SC-45-WHEELSET', 'VISION-SC-45-WHEELSET']);

// A handle with one variant is a product sold one way. A group of one is a
// heading a customer has to click through to reach a single product.
eq('a product sold one way is not a range',
   [bySku('VIS-BOTTLE').model, bySku('VIS-BOTTLE').size], [null, null]);
eq('and keeps its own name', bySku('VIS-BOTTLE').name, 'Vision Bottle');

// A row Shopify wrote for its own bookkeeping is not a product.
eq('a row with no SKU is not a product',
   flattenShopify([{ Handle: 'x', Title: 'X', 'Variant SKU': '' }]).length, 0);
eq('and neither is one with no handle',
   flattenShopify([{ Handle: '', 'Variant SKU': 'ABC' }]).length, 0);

process.exit(fail ? 1 : 0);
