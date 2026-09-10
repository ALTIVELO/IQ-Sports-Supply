const { classifyProduct, CATEGORIES, CATEGORY_BY_SLUG } = await import('../../.test-build/catalogue/categories.js');

let fail = 0;
const is = (name, expected) => {
  const got = classifyProduct({ name });
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${JSON.stringify(name).padEnd(52)} → ${got}${ok ? '' : `  (expected ${expected})`}`);
};

console.log('── the real catalogue rows we already have');
is('Shimano Dura-Ace BB-R9100 Bottom Bracket BSA',      'bottom-brackets');
is('Shimano Brake Pad L05A Resin w/ Fin',               'brake-pads');
is('Shimano Brake Pad B05S Resin',                      'brake-pads');
is('Shimano Dura-Ace FC-R9200 Crankset 170mm 52-36',    'chainsets');
is('Tripeak AOPW Oversized Pulley Wheel 54T',           'pulleys');

console.log('\n── the ordering traps: these all contain "chain" or "brake"');
is('Shimano Ultegra CN-HG701 Chain 11-speed',           'chains');
is('Shimano 105 FC-R7000 Chainset 52-36',               'chainsets');
is('Shimano Dura-Ace Chainring 54T',                    'chainrings');
is('SRAM Red Crank Arm 172.5mm',                        'chainsets');
is('KMC Quick Link 11-speed',                           'chains');
is('Shimano BR-R7070 Hydraulic Disc Brake Caliper',     'brakes');
is('Shimano SM-RT800 Centre Lock Disc Rotor 160mm',     'rotors');
is('Park Tool Chain Whip SR-12.2',                      'tools');

console.log('\n── rim brake vs rim, tube vs tubeless');
is('Shimano BR-6810 Rim Brake Caliper',                 'brakes');
is('Mavic Open Pro Rim 32h',                            'wheels');
is('Continental Race 28 Inner Tube 700x25',             'tubes');
is('Continental GP5000 Tubeless Tyre 700x28',           'tyres');

console.log('\n── a spread of the rest');
is('Shimano CS-R8100 Cassette 11-30T',                  'cassettes');
is('Shimano RD-R8150 Di2 Rear Derailleur',              'derailleurs');
is('Shimano ST-R7020 Shifter Pair',                     'shifters');
is('Shimano PD-R8000 Pedals',                           'pedals');
is('Fizik Arione Saddle',                               'saddles');
is('Deda Zero100 Stem 110mm',                           'stems');
is('Muc-Off Bio Degreaser 500ml',                       'lubricants');
is('Jagwire Road Pro Brake Cable Kit',                  'cables');
is('Enduro Bearings ABEC-3 Cartridge Bearing',          'bearings');

console.log('\n── things that should stay uncategorised rather than be guessed');
is('Tripeak AOPW-54',                                    null);
is('Miscellaneous item',                                 null);
is('',                                                   null);

console.log('\n── compound terms where the LAST word decides the category');
is('Park Tool Chain Whip SR-12.2',                      'tools');
is('Shimano TL-CN10 Chain Tool',                        'tools');
is('Park Tool SW-42 Spoke Wrench',                      'tools');
is('Shimano TL-FC16 Bottom Bracket Tool',               'tools');
is('Jagwire Road Pro Brake Cable Kit',                  'cables');
is('Shimano Optislick Gear Cable Set',                  'cables');
is('Muc-Off C3 Dry Chain Lube 50ml',                    'lubricants');
is('Finish Line Chain Degreaser',                       'lubricants');
is('Shimano Mineral Brake Fluid 1L',                    'lubricants');
is('Enduro Bottom Bracket Bearings BB86',               'bearings');
is('Shimano SM-RT70 Disc Brake Rotor',                  'rotors');

console.log('\n── and the plain forms still land where they should');
is('Shimano Ultegra CN-HG701 Chain 11-speed',           'chains');
is('Shimano BR-R7070 Disc Brake Caliper',               'brakes');
is('Enduro ABEC-3 Cartridge Bearing',                   'bearings');

console.log('\n── data integrity');
const slugs = CATEGORIES.map(c => c.slug);
const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
if (dupes.length) { fail++; console.log('FAIL  duplicate slugs:', dupes); }
else console.log('PASS  category slugs are unique');

// Every rule must point at a category that exists.
const missing = [];
for (const name of ['Brake Pad','Rotor','Chain','Crankset','Cassette','Saddle']) {
  const slug = classifyProduct({ name });
  if (slug && !CATEGORY_BY_SLUG.has(slug)) missing.push(slug);
}
if (missing.length) { fail++; console.log('FAIL  rules point at unknown categories:', missing); }
else console.log('PASS  every rule maps to a real category');

process.exit(fail ? 1 : 0);
