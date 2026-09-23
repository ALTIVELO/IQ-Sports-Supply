#!/usr/bin/env node
/**
 * What a complete groupset comes to, per tier.
 *
 *   node scripts/shimano/groupset-prices.mjs <catalogue.csv>
 *
 * The builder sells a groupset as its parts: thirteen lines, each at its own
 * price, so a customer can change any of them. That is right for ordering and
 * useless for answering "what does a Dura-Ace groupset cost", which is the
 * question a shop asks first and the one the screen cannot answer until
 * everything is chosen.
 *
 * So this adds the parts up, from the same sheet the catalogue is imported
 * from, at the same prices. Rotors and wires are in — a groupset without
 * brakes or wiring is not a groupset. The bottom bracket is out, and there is
 * nothing to leave out: the builder has no bottom bracket step, because which
 * cups a frame takes is a property of the frame and not of the groupset. It is
 * reported separately at the foot so nobody forgets to add one.
 *
 * Every choice moves the total, so the headline is one stated specification
 * and the swing is printed under it. A quote built on the cheapest of
 * everything is a quote somebody will be held to.
 */
import { readFileSync } from 'node:fs';

const parseCsv = (text) => {
  const rows = [];
  let row = [], field = '', quoted = false;
  const body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
};

const TIERS = ['Our cost', 'Distributor', 'Shop', 'Club', 'Retail'];
const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The thirteen steps, as the builder defines them.
 *
 * Kept as SKU patterns rather than as a list of part numbers, so this and the
 * builder are answering from the same rule: a part the supplier adds appears
 * in both or in neither.
 */
const BUILDS = [
  { name: 'Dura-Ace Di2 R9200', power: false,
    parts: ['R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR9200(?!P)/, cassette: /^CSR9200/, chain: /^CNM9100/, rotor: /^RTCL900/ },
  { name: 'Dura-Ace Di2 R9200, power meter', power: true,
    parts: ['R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR9200P/, cassette: /^CSR9200/, chain: /^CNM9100/, rotor: /^RTCL900/ },
  { name: 'Ultegra Di2 R8100', power: false,
    parts: ['R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR8100(?!P)/, cassette: /^CSR8101/, chain: /^CNM8100/, rotor: /^RTCL800/ },
  { name: 'Ultegra Di2 R8100, power meter', power: true,
    parts: ['R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR8100P/, cassette: /^CSR8101/, chain: /^CNM8100/, rotor: /^RTCL800/ },
];

const WIRE = /^EWSD300/;

/** The specification quoted, where the builder offers a choice. */
const PREFERRED = {
  chainset: '52/36 172.5mm',
  cassette: '11-30T',
  frontRotor: '160mm',
  rearRotor: '140mm',
};

export function priceBuild(rows, build) {
  const bySku = new Map(rows.map((r) => [r.SKU, r]));
  const matching = (re) => rows.filter((r) => re.test(r.SKU));

  /*
   * Matched on the front of the label, not the whole of it.
   *
   * A rotor's size reads "160mm (I)" — the bracket is the lockring, which is
   * part of the product and not part of the size anybody asks for. An exact
   * match on "160mm" finds nothing and falls back to the first rotor in the
   * list, which quietly quoted two fronts and no rear.
   */
  const pickSize = (list, wanted) =>
    list.find((r) => (r.Size ?? '').trim() === wanted)
    ?? list.find((r) => (r.Size ?? '').trim().startsWith(wanted))
    ?? list[0] ?? null;

  const chainsets = matching(build.chainset);
  const cassettes = matching(build.cassette);
  const chains = matching(build.chain);
  const rotors = matching(build.rotor);
  const wires = matching(WIRE);

  const chosen = [
    ...build.parts.map((s) => bySku.get(s)).filter(Boolean),
    pickSize(chainsets, PREFERRED.chainset),
    pickSize(cassettes, PREFERRED.cassette),
    chains[0],
    pickSize(rotors, PREFERRED.frontRotor),
    pickSize(rotors, PREFERRED.rearRotor),
    // Two runs: the builder asks for a length each and a frame decides them.
    // The median of what is stocked stands in, and the swing below says what
    // the choice is worth.
    wires[Math.floor(wires.length / 2)],
    wires[Math.floor(wires.length / 2)],
  ].filter(Boolean);

  const total = (tier) => chosen.reduce((sum, r) => sum + (money(r[tier]) ?? 0), 0);

  /*
   * What the choices are worth, at one tier.
   *
   * The cheapest and dearest of everything the builder would let somebody
   * pick, so a quote can be given as a figure rather than as a figure that
   * turns out to have been the floor.
   */
  const swing = (tier) => {
    const ends = (list, n = 1) => {
      const priced = list.map((r) => money(r[tier])).filter((v) => v !== null).sort((a, b) => a - b);
      if (!priced.length) return [0, 0];
      return [priced[0] * n, priced[priced.length - 1] * n];
    };
    const fixed = build.parts.reduce((s, sku) => s + (money(bySku.get(sku)?.[tier]) ?? 0), 0);
    const pairs = [ends(chainsets), ends(cassettes), ends(chains),
                   ends(rotors, 2), ends(wires, 2)];
    return [fixed + pairs.reduce((s, [lo]) => s + lo, 0),
            fixed + pairs.reduce((s, [, hi]) => s + hi, 0)];
  };

  return { chosen, total, swing, counts: {
    chainsets: chainsets.length, cassettes: cassettes.length,
    rotors: rotors.length, wires: wires.length } };
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: groupset-prices.mjs <catalogue.csv>');
  const rows = parseCsv(readFileSync(file, 'utf8'));

  const gbp = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (s, n) => String(s).padStart(n);

  console.log(`Rotors and wires included · no bottom bracket · `
    + `${PREFERRED.chainset} chainset, ${PREFERRED.cassette} cassette, `
    + `${PREFERRED.frontRotor}/${PREFERRED.rearRotor} rotors, two Di2 wires\n`);
  console.log('Build'.padEnd(34) + TIERS.map((t) => pad(t, 11)).join(''));

  for (const build of BUILDS) {
    const { total } = priceBuild(rows, build);
    console.log(build.name.padEnd(34) + TIERS.map((t) => pad(gbp(total(t)), 11)).join(''));
  }

  console.log('\nWhat the choices are worth, at Distributor:');
  for (const build of BUILDS) {
    const { swing, chosen } = priceBuild(rows, build);
    const [lo, hi] = swing('Distributor');
    console.log(`  ${build.name.padEnd(34)} ${gbp(lo)} to ${gbp(hi)}  `
      + `(${chosen.length} parts)`);
  }

  if (process.argv.includes('--itemise')) {
    for (const build of BUILDS) {
      console.log(`\n${build.name}`);
      const { chosen, total } = priceBuild(rows, build);
      for (const r of chosen) {
        console.log(`  ${r.SKU.padEnd(15)}${(r.Size || '').padEnd(16)}`
          + `${pad(gbp(money(r.Distributor) ?? 0), 10)}  ${r.Name.slice(0, 44)}`);
      }
      console.log(`  ${''.padEnd(31)}${pad(gbp(total('Distributor')), 10)}  ${chosen.length} parts`);
    }
  }

  // Not part of a groupset, and needed to fit one. Which cups a frame takes is
  // a property of the frame; the builder has no step for it and this is the
  // line that stops that being mistaken for "you do not need one".
  console.log('\nBottom bracket — not included, ordered separately:');
  for (const sku of ['BBR9100B', 'BBR9100I', 'BBRS501B']) {
    const r = rows.find((x) => x.SKU === sku);
    if (r) {
      console.log(`  ${sku.padEnd(12)} ${r.Name.slice(0, 44).padEnd(46)}`
        + TIERS.map((t) => pad(money(r[t]) ? gbp(money(r[t])) : '-', 11)).join(''));
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
