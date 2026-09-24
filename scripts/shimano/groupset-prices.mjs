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
  { name: 'Dura-Ace Di2 R9270', power: false,
    parts: ['R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR9200(?!P)/, cassette: /^CSR9200/, chain: /^CNM9100/, rotor: /^RTCL900/ },
  { name: 'Dura-Ace Di2 R9270, power meter', power: true,
    parts: ['R9270DLR', 'R9270DRF', 'RDR9250', 'FDR9250F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR9200P/, cassette: /^CSR9200/, chain: /^CNM9100/, rotor: /^RTCL900/ },
  { name: 'Ultegra Di2 R8170', power: false,
    parts: ['R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR8100(?!P)/, cassette: /^CSR8101/, chain: /^CNM8100/, rotor: /^RTCL800/ },
  { name: 'Ultegra Di2 R8170, power meter', power: true,
    parts: ['R8170DLR', 'R8170DRF', 'RDR8150', 'FDR8150F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR8100P/, cassette: /^CSR8101/, chain: /^CNM8100/, rotor: /^RTCL800/ },
  /*
   * 105 and GRX are quoted on their own specification, not the road one.
   *
   * Neither is made in 52/36 and neither cassette is written with a T, so
   * asking for the shared preference finds nothing on either — and pickSize
   * answers a miss with the first of the list. That would have quoted a 165mm
   * crank and whichever cassette sorted first, under a heading saying 52/36
   * and 11-30T. Hence `prefer`, and hence the warning when a preference is
   * not found at all.
   */
  { name: '105 Di2 R7170', power: false,
    parts: ['R7170DLR', 'R7170DRF', 'RDR7150', 'FDR7150F', 'BTDN300', 'EWEC300'],
    chainset: /^FCR7100(?!P)/, cassette: /^(CSR7101|CSHG710)/,
    chain: /^CNM7100/, rotor: /^RTCL700/,
    prefer: { chainset: '50/34 172.5mm', cassette: '11-34' } },
  /*
   * The gravel build, and the double rather than the single ring: FD-RX825 is
   * cut for a 48T and RD-RX825 reaches a 36T, which is the FC-RX8202 48/31.
   * The 1x RX8201 cranks want a different mech and no front derailleur, so
   * they are a different groupset rather than a cheaper option on this one.
   */
  { name: 'GRX Di2 RX825', power: false,
    parts: ['RX825LR', 'RX825RF', 'RDRX825', 'FDRX825F', 'BTDN300', 'EWEC300'],
    chainset: /^FCRX8202/, cassette: /^(CSHG710|CSR7101)/,
    chain: /^CNM8100/, rotor: /^RTCL800/,
    prefer: { chainset: '48/31 172.5mm', cassette: '11-36' } },
];

const WIRE = /^EWSD300/;

/**
 * The specification quoted, where the builder offers a choice.
 *
 * The road default, which a build overrides with its own `prefer` where its
 * range is written differently — 105 has no 52/36 and GRX no cassette with a
 * T on it.
 */
const PREFERRED = {
  chainset: '52/36 172.5mm',
  cassette: '11-30T',
  frontRotor: '160mm',
  rearRotor: '140mm',
};

/**
 * What a row's size reads as.
 *
 * The Size column where the sheet filled one, and the end of the name where
 * it did not. A size is written into that column only to tell a model's
 * siblings apart, so a cassette that is the only one of its model carries
 * none at all — which is both of the twelve-speed ranges the 105 and GRX
 * builds are quoted on, CS-R7101 11-34 and CS-HG710 11-36. Matching on the
 * column alone found neither and fell through to whichever sorted first.
 */
export const sizeText = (r) => {
  const stated = (r.Size ?? '').trim();
  if (stated) return stated;
  const m = String(r.Name ?? '').match(/(\d{2}\s*-\s*\d{2}\s*T?)\s*$/i);
  return m ? m[1].replace(/\s/g, '') : '';
};

export function priceBuild(rows, build) {
  const bySku = new Map(rows.map((r) => [r.SKU, r]));
  const matching = (re) => rows.filter((r) => re.test(r.SKU));
  const want = { ...PREFERRED, ...(build.prefer ?? {}) };
  /** Preferences nothing in the list answered, so a quote can say so. */
  const missed = [];

  /*
   * Matched on the front of the label, not the whole of it.
   *
   * A rotor's size reads "160mm (I)" — the bracket is the lockring, which is
   * part of the product and not part of the size anybody asks for. An exact
   * match on "160mm" finds nothing and falls back to the first rotor in the
   * list, which quietly quoted two fronts and no rear.
   */
  const pickSize = (list, wanted) => {
    const hit = list.find((r) => sizeText(r) === wanted)
      ?? list.find((r) => sizeText(r).startsWith(wanted));
    /*
     * Falling back to the first of the list is how this has always ended, and
     * it is the dangerous bit: a quote comes out under a heading naming a
     * specification it is not for. So the miss is recorded and printed rather
     * than swallowed.
     */
    if (!hit && list.length) missed.push(wanted);
    return hit ?? list[0] ?? null;
  };

  const chainsets = matching(build.chainset);
  const cassettes = matching(build.cassette);
  const chains = matching(build.chain);
  const rotors = matching(build.rotor);
  const wires = matching(WIRE);

  const chosen = [
    ...build.parts.map((s) => bySku.get(s)).filter(Boolean),
    pickSize(chainsets, want.chainset),
    pickSize(cassettes, want.cassette),
    chains[0],
    pickSize(rotors, want.frontRotor),
    pickSize(rotors, want.rearRotor),
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

  return { chosen, total, swing, want, missed, counts: {
    chainsets: chainsets.length, cassettes: cassettes.length,
    rotors: rotors.length, wires: wires.length } };
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: groupset-prices.mjs <catalogue.csv>');
  const rows = parseCsv(readFileSync(file, 'utf8'));

  const gbp = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (s, n) => String(s).padStart(n);

  console.log('Rotors and wires included · no bottom bracket · two Di2 wires\n');
  console.log('Build'.padEnd(34) + TIERS.map((t) => pad(t, 11)).join(''));

  for (const build of BUILDS) {
    const { total } = priceBuild(rows, build);
    console.log(build.name.padEnd(34) + TIERS.map((t) => pad(gbp(total(t)), 11)).join(''));
  }

  /*
   * Which specification each figure is for.
   *
   * Printed per build rather than once at the top, because they are no longer
   * the same: a 105 groupset has no 52/36 and GRX is a 48/31. A total under a
   * heading naming the wrong chainring is worse than no total.
   */
  console.log('\nQuoted specification:');
  for (const build of BUILDS) {
    const { want, missed } = priceBuild(rows, build);
    console.log(`  ${build.name.padEnd(34)} ${want.chainset}, ${want.cassette} cassette, `
      + `${want.frontRotor}/${want.rearRotor} rotors`
      + (missed.length ? `   [not found: ${[...new Set(missed)].join(', ')}]` : ''));
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
        console.log(`  ${r.SKU.padEnd(15)}${sizeText(r).padEnd(16)}`
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
