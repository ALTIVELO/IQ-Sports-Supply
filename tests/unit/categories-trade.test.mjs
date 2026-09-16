const { classifyProduct } = await import('../../.test-build/catalogue/categories.js');
let fail = 0;
const is = (name, expected) => {
  const got = classifyProduct({ name });
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${JSON.stringify(name).padEnd(56)} → ${got}${ok ? '' : `  (expected ${expected})`}`);
};

console.log('── the trade shorthand actually used in the JMM order form');
is('STI LVR STR9270/BRR9270 Di2 hydra LH RR',       'shifters');
is('STI LVR STR8170/BRR8170 Di2 hydra RH FR',       'shifters');
is('RR MECH D/Ace Di2 R9250 12spd',                 'derailleurs');
is('FR MECH D/Ace Di2 R9250 12spd braze',           'derailleurs');
is('C/SET D/Ace R9200 50/34 160mm',                 'chainsets');
is('C/SET Ultegra R8100 52/36 170mm',               'chainsets');
is('CASS D/Ace R9200 12 spd 11-30T',                'cassettes');
is('CHAIN XTR/DuraAce 12spd 126L Q/Link',           'chains');
is('BATT Di2 DN300 internal',                       'electronics');
is('CHARGER EWEC300 charging cable 1700mm',         'electronics');
is('CABLE E-tube Di2 SD300 900mm',                  'electronics');
is('Power 50 / 34 - double - 160 mm',               'power-meters');
is('Power 54 / 40 - double - 175 mm',               'power-meters');
is('Dura-Ace Di2 R9200 — Standard Build 11-30T)',   'groupsets');
is('Ultegra Di2 R8100 — with Powermeter Chainset',  'groupsets');
is('J05A-RF disc pads and spring - alloy back with cooling fins', 'brake-pads');
is('B05S disc pads and spring - steel back - resin - box', 'brake-pads');

console.log('\n── and the earlier rules are untouched');
is('Shimano Dura-Ace BB-R9100 Bottom Bracket BSA',  'bottom-brackets');
is('Park Tool Chain Whip SR-12.2',                  'workshop-tools');
is('Jagwire Road Pro Brake Cable Kit',              'cables');
is('Muc-Off C3 Dry Chain Lube 50ml',                'lubricants');
is('Shimano Ultegra CN-HG701 Chain 11-speed',       'chains');
console.log('\n── complete groupset bundles, named after what is inside them');
// Every one of these lines names a component; the bundle is not that component.
is('Dura-Ace Di2 R9200 — Standard Build 11-30T',        'groupsets');
is('Dura-Ace Di2 R9200 — with Powermeter Chainset',     'groupsets');
is('Dura-Ace Di2 R9200 — with Rotors (RTCL900)',        'groupsets');
is('Ultegra Di2 R8100 — Standard Build 11-30T',         'groupsets');
is('Ultegra Di2 R8100 — with Powermeter Chainset',      'groupsets');
is('Ultegra Di2 R8100 — with Rotors (RTCL800)',         'groupsets');
is('Complete Groupset Shimano 105 R7100',               'groupsets');

console.log('\n── but the components themselves are still components');
is('C/SET D/Ace R9200 50/34 160mm',                     'chainsets');
is('CASS D/Ace R9200 12 spd 11-30T',                    'cassettes');
is('Power 52 / 36 - double - 170 mm',                   'power-meters');
is('RR MECH D/Ace Di2 R9250 12spd',                     'derailleurs');

process.exit(fail ? 1 : 0);
