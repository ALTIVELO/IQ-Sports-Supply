const { classifyProduct, CATEGORIES, GROUPS, collectionsIn } =
  await import('../../.test-build/catalogue/categories.js');
let fail = 0;
const is = (name, expected) => {
  const got = classifyProduct({ name });
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok?'PASS ':'FAIL '} ${JSON.stringify(name).padEnd(50)} → ${got}${ok?'':`  (expected ${expected})`}`);
};

console.log('── a whole bike names half the component vocabulary in passing');
is('Specialized Tarmac SL8 Road Bike Ultegra Di2',   'road-bikes');
is('Cannondale Topstone Gravel Bike GRX',            'gravel-bikes');
is('Trek Marlin Mountain Bike 29er',                 'mountain-bikes');
is('Specialized Turbo Vado Electric Bike',           'e-bikes');
is('Frog 52 Kids Bike',                              'kids-bikes');
is('Giant Defy Frameset Road',                       'road-frames');
is('RockShox SID Suspension Fork 100mm',             'forks');

console.log('\n── helmets, by type and without one');
is('Giro Aether Road Helmet',                        'road-helmets');
is('Fox Proframe Full Face Helmet',                  'mtb-helmets');
is('Kask Bambino Aero Helmet',                       'aero-helmets');
is('Generic Helmet Medium',                          'helmets');

console.log('\n── clothing');
is('Castelli Competizione Jersey',                   'jerseys');
is('Assos Mille GT Bib Shorts',                      'shorts');
is('Rapha Core Rain Jacket',                         'jackets');
is('dhb Merino Base Layer',                          'base-layers');
is('Sportful Fiandre Gloves',                        'gloves');
is('Defeet Aireator Socks',                          'socks');
is('Shimano RC3 Road Shoes 43',                      'shoes');
is('Oakley Sutro Sunglasses',                        'eyewear');

console.log('\n── accessories');
is('Elite Fly Water Bottle 550ml',                   'bottles');
is('Exposure Strada Front Light',                    'lights');
is('Garmin Edge 840 Bike Computer',                  'computers');
is('Lezyne Micro Floor Drive Pump',                  'pumps');
is('Abus Granit D-Lock',                             'locks');
is('Ortlieb Back-Roller Panniers',                   'luggage');
is('SKS Bluemels Mudguards 700c',                    'mudguards');

console.log('\n── tools, now split by type');
is('Park Tool TW-5.2 Torque Wrench',                 'torque-tools');
is('Shimano Bleed Kit for Hydraulic Brakes',         'bleed-kits');
is('Park Tool SW-42 Spoke Wrench',                   'wheel-tools');
is('Park Tool Chain Whip SR-12.2',                   'workshop-tools');

console.log('\n── none of this disturbed the component rules');
is('Shimano Dura-Ace BB-R9100 Bottom Bracket BSA',   'bottom-brackets');
is('C/SET D/Ace R9200 52/36 170mm',                  'chainsets');
is('CASS Ultegra R8101 12 spd 11-30T',               'cassettes');
is('CHAIN XTR/DuraAce 12spd 126L Q/Link',            'chains');
is('RR MECH D/Ace Di2 R9250 12spd',                  'derailleurs');
is('STI LVR STR9270/BRR9270 Di2 hydra LH RR',        'shifters');
is('BATT Di2 DN300 internal',                        'electronics');
is('J05A-RF disc pads and spring',                   'brake-pads');
is('Muc-Off C3 Dry Chain Lube 50ml',                 'lubricants');
is('Jagwire Road Pro Brake Cable Kit',               'cables');
is('Mavic Open Pro Rim 32h',                         'wheels');
is('Continental GP5000 Tubeless Tyre 700x28',        'tyres');

console.log('\n── the tree itself');
const check = (l, ok, d='') => { if(!ok) fail++; console.log(`${ok?'PASS ':'FAIL '} ${l}${d?'  '+d:''}`); };
check('eight groups', GROUPS.length === 8, String(GROUPS.length));
check('every category has a known parent',
  CATEGORIES.every(c => c.parent === null || CATEGORIES.some(g => g.slug === c.parent)));
check('every parent is itself a group',
  CATEGORIES.every(c => c.parent === null ||
    CATEGORIES.find(g => g.slug === c.parent)?.parent === null));
check('no group is empty', GROUPS.every(g => collectionsIn(g.slug).length > 0));
check('slugs unique', new Set(CATEGORIES.map(c=>c.slug)).size === CATEGORIES.length);
check('70 categories', CATEGORIES.length === 70, String(CATEGORIES.length));
// Every slug a rule can return must exist.
const bad = [];
for (const n of ['Road Bike','Helmet','Jersey','Pump','Torque Wrench','Chain','Frame'])
  { const s2 = classifyProduct({name:n}); if (s2 && !CATEGORIES.some(c=>c.slug===s2)) bad.push([n,s2]); }
check('every rule points at a real category', bad.length===0, JSON.stringify(bad));
process.exit(fail ? 1 : 0);
