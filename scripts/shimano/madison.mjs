#!/usr/bin/env node
/**
 * Turns Madison's master Shimano price list into the sheet rebuild.mjs reads.
 *
 *   node scripts/shimano/madison.mjs <master.xlsx> <out.csv> \
 *     [--buffer 5] [--tiers "Distributor=8,Shop=12,Club=18"]
 *
 * The supplier's workbook is a printed catalogue rather than a data file. One
 * column block — Description, Notes, Madison Code, Barcode, SRP, UOM, IQ
 * Sports Price — with a section heading every few rows and no code against
 * it, and descriptions that only make sense underneath one: "50 / 34 - double
 * - 170 mm" is a chainset only because of the heading four rows above it.
 *
 * So the headings are carried down. A description that already names a range
 * is left exactly as the supplier wrote it; one that does not is given the
 * heading it sat under, which is the difference between "50 / 34 - double -
 * 170 mm" and "Dura-Ace FC-R9200-P Power Meter 50 / 34 - double - 170 mm".
 * Nothing is invented: every word comes from the sheet.
 *
 * ── the buffer ──────────────────────────────────────────────────────────
 *
 * Madison quote this list as a quote. Their words: "this should be treated as
 * a quote and not the final price … the final price may have to change by a %
 * here and there". A price list we publish to the trade cannot move every
 * time theirs does, so the cost we price from is theirs plus a margin of
 * error, and --buffer is it.
 *
 * It goes into the cost, not on to the tiers, because that is where it has to
 * be for the tiers to inherit it: buffer first, then the standard rates on
 * the buffered figure. The consequence is that Our cost on this sheet is what
 * we expect to pay rather than what the quote says today, which is the point
 * of it and is worth knowing when reading a margin off it.
 *
 * It is not written into Price note. That column is shown to customers, and
 * what we pay is not their business.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The site's own classifier, compiled on the fly so there is one copy of it. */
async function loadClassifier() {
  const out = mkdtempSync(join(tmpdir(), 'iq-classify-'));
  execFileSync('npx', ['tsc', join(root, 'src/lib/catalogue/categories.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'bundler', '--skipLibCheck'], { stdio: 'ignore' });
  return import(join(out, 'categories.js'));
}

export const COLUMNS = ['Description', 'Notes', 'Madison Code', 'Barcode',
  'SRP', 'UOM', 'IQ Sports Price'];

/** Ranges Shimano name in a description. A row naming one describes itself. */
const NAMES_A_RANGE =
  /\b(dura-?ace|ultegra|105|tiagra|sora|claris|grx|xtr|xt|slx|deore|cues|alivio|altus|acera|di2|steps|nexus|alfine|saint|zee|dxr)\b/i;

/**
 * What each of Madison's section headings is a section of.
 *
 * Read off the headings rather than out of the descriptions, because a
 * description on this sheet is a variant and not a product: "50 / 34 - double
 * - 170 mm" classifies as nothing, and "GRX RX820 - without bottom bracket
 * 40T" classifies as a bottom bracket, which is the opposite of true. The
 * heading above it says "Chainsets" and is never wrong.
 *
 * Order matters: the first match wins, so the specific ones come first —
 * "Disc brake rotors" before "Disc brake", "Brake pads" before "Brake".
 */
const SECTIONS = [
  [/\brotors?\b|\bcent(er|re)\s*lock\b/i, 'rotors'],
  [/\bbrake\s*pads?\b|\bpads?\b/i, 'brake-pads'],
  // Before electronics: a shift switch is a shifter even though the heading
  // goes on to say which wire it takes.
  [/\bshifters?\b|\bSTI\b|\bshift\s*(switch|lever)|\bgear\s*lever/i, 'shifters'],
  // And before bottom brackets: a "bottom bracket junction" is a Di2 junction
  // box that happens to live at the bottom bracket.
  [/\bwires?\b|\bjunctions?\b|\bbatter(y|ies)\b|\bcharger|\bE-?tube\b|\bswitch/i,
   'electronics'],
  // Before bottom brackets, because "Chainsets - HollowTech II" is a
  // chainset heading that names the bottom bracket standard it fits.
  [/\bchainsets?\b|\bcranksets?\b|\bcrank\s*arm|\bpower\s*meter/i, 'chainsets'],
  [/\bchainrings?\b/i, 'chainrings'],
  [/\bbottom\s*bracket|hollowtech|press[-\s]?fit|\bcups\b/i, 'bottom-brackets'],
  [/\bcassettes?\b|\bsprockets?\b/i, 'cassettes'],
  [/\bchains?\b/i, 'chains'],
  [/\bderailleurs?\b|\bmech(anism)?s?\b|\bbraze[-\s]?on\b/i, 'derailleurs'],
  // Before brakes: a wheel heading routinely says what brake it is for.
  [/\bwheels?(ets?)?\b|\bclincher\b|\btubeless\b/i, 'wheels'],
  [/\bhubs?\b|\bfreehubs?\b/i, 'hubs'],
  [/\bcallipers?\b|\bcalipers?\b|\bbrakes?\b|\blevers?\b/i, 'brakes'],
  [/\bpedals?\b/i, 'pedals'],
  [/\bcables?\b|\bhousings?\b/i, 'cables'],
  [/\btools?\b/i, 'tools'],
  [/\badapters?\b|\bspares?\b|\baccessor/i, 'accessories'],
];

/**
 * A heading naming one model rather than a kind of part.
 *
 * The sheet mixes the two: "Cassettes" is a section, "Dura-Ace R9270 Di2 -
 * 12-speed - E-tube fit for SD300 wires" is the model whose sizes follow. Only
 * the first says what a part is, and reading the second as one filed every
 * Dura-Ace shifter under electronics, because its heading mentions wires.
 *
 * A Shimano model code is three or four digits with at most two letters in
 * front — R9200, RX820, 9250. Deliberately not two digits, which would catch
 * "Cassettes - 11-speed" and "49 mm Drop", and not four-plus, which would
 * catch a barcode.
 */
export const namesAModel = (heading) =>
  /\b[A-Z]{0,2}\d{3,4}\b/.test(String(heading ?? '').toUpperCase());

/**
 * The collection a part belongs to, from the nearest section heading.
 *
 * Nearest, not first: a block runs "Cassettes" then "Dura-Ace R9200 12-speed"
 * then the rows, and only the outer heading says what they are. Walking back
 * up the run of headings finds it without needing to know how deeply anything
 * is nested, which the sheet does not record.
 */
export function sectionCategory(headings) {
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    if (namesAModel(headings[i])) continue;
    for (const [pattern, slug] of SECTIONS) {
      if (pattern.test(headings[i])) return slug;
    }
  }
  return null;
}

/**
 * A heading, cleaned of the things it says to the person reading the printed
 * list rather than about the part.
 *
 * "Dura-Ace - FC-R9200-P Power Meter (please also order bottom bracket cups)"
 * is a model and an instruction to a buyer. The instruction does not belong in
 * a product name on an invoice.
 */
export function tidyHeading(text) {
  return String(text ?? '')
    .replace(/\((?:please|note|order|also|includes?)[^)]*\)/gi, '')
    .replace(/\s*-\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * What to call a part.
 *
 * A description naming its own range is the supplier's own words and is kept.
 * One that does not is a variant of whatever the heading above it was, so the
 * two are joined — the heading first, because that is the order the printed
 * list reads in and the order a catalogue groups by.
 */
export function productName(description, heading) {
  const desc = String(description ?? '').replace(/\s{2,}/g, ' ').trim();
  if (!desc) return tidyHeading(heading);
  if (NAMES_A_RANGE.test(desc)) return desc;
  const head = tidyHeading(heading);
  if (!head || NAMES_A_RANGE.test(desc) || desc.startsWith(head)) return desc;
  return `${head} ${desc}`;
}

/**
 * The workbook's own column names, trimmed.
 *
 * Its last heading is "IQ Sports Price " with a trailing space, which is
 * invisible in Excel and makes every lookup of it miss. Read by an exact key
 * that is one space short, the whole sheet came out unpriced — 351 parts, all
 * of them reported as "Madison have not priced yet", which is a plausible
 * enough sentence to have been believed.
 */
export const tidyKeys = (row) => Object.fromEntries(
  Object.entries(row).map(([k, v]) => [String(k).trim(), v]));

/** A row with a description and no code is a heading, not a part. */
const isHeading = (r) => !!String(r['Description'] ?? '').trim()
  && !String(r['Madison Code'] ?? '').trim();

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Reads the workbook into one row per unique Madison code.
 *
 * A code listed twice is the same part appearing under two headings — a pedal
 * under Dura-Ace and again under Pedals. The first wins, and a second listing
 * whose price disagrees is reported rather than silently resolved, because
 * then it is not the same part and one of the two names is wrong.
 */
export function readMaster(grid, { buffer = 0.05, tiers = [] } = {}, classify) {
  const out = [];
  const seen = new Map();
  const repeated = [];
  const conflicting = [];
  /*
   * Every heading seen since the last product row.
   *
   * The sheet nests headings and records nothing about how deeply, so the
   * run of them is kept and read back to front: the nearest one names the
   * part, the nearest one that matches a section says what it is.
   */
  let headings = [];
  let heading = '';

  for (const raw of grid) {
    const row = tidyKeys(raw);
    if (isHeading(row)) {
      heading = String(row['Description']).trim();
      // A heading that repeats one already in the run is the start of a new
      // block at that level, so the deeper ones it replaces are dropped.
      const at = headings.findIndex((h) => h === heading);
      headings = at >= 0 ? [...headings.slice(0, at), heading] : [...headings, heading];
      continue;
    }
    const sku = String(row['Madison Code'] ?? '').trim().toUpperCase();
    if (!sku) continue;

    const quote = money(row['IQ Sports Price']);
    const srp = money(row['SRP']);
    const name = productName(row['Description'], heading);

    const before = seen.get(sku);
    if (before) {
      repeated.push(sku);
      if (before.quote !== quote || before.srp !== srp) conflicting.push(sku);
      continue;
    }

    // Madison's quote plus the margin of error they asked us to leave. A row
    // they have not priced yet gets no cost and no tier price: the product
    // still exists, with its RRP, and simply cannot be sold until it has one.
    const cost = quote === null ? null : quote * (1 + buffer);
    const record = {
      Name: name,
      SKU: sku,
      Brand: 'Shimano',
      // The heading first, the site's own classifier only where no heading
      // says. The classifier reads a whole product name and these are
      // fragments, so trusting it here filed wheels under rotors.
      /*
       * A part whose name says Power Meter is a power meter, whatever section
       * it was printed under.
       *
       * Madison print them under "Chainsets - HollowTech II", which is true —
       * they are chainsets — and leaves FC-R9200-P and FC-R9200 in one
       * collection, where the model key and the size come out identical and a
       * £464 power meter hides behind a £165 chainset. They are their own
       * collection here, as they were on the last sheet.
       */
      Category: /\bpower\s*meter/i.test(name)
        ? 'power-meters'
        : sectionCategory(headings) ?? classify({ name, brand: 'Shimano', sku }) ?? '',
      'Our cost': cost === null ? '' : cost.toFixed(2),
      Retail: srp === null ? '' : srp.toFixed(2),
      quote, srp,
    };
    for (const { name: tier, rate } of tiers) {
      record[tier] = cost === null ? '' : (cost * (1 + rate)).toFixed(2);
    }
    seen.set(sku, record);
    out.push(record);
  }

  return { rows: out, repeated, conflicting };
}

const cell = (v) => {
  const s = String(v ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))]
    .join('\n') + '\n';

function parseArgs(argv) {
  const [input, output, ...rest] = argv;
  const args = {
    input,
    output,
    buffer: 0.05,
    // The rates this catalogue has always used, read off the prices already
    // published: 189.20 at cost is 204.34, 211.91 and 223.26 across the three
    // tiers. Stated here rather than rediscovered, and overridable, because a
    // rate nobody can find is a rate nobody can change.
    tiers: [
      { name: 'Distributor', rate: 0.08 },
      { name: 'Shop', rate: 0.12 },
      { name: 'Club', rate: 0.18 },
    ],
  };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--buffer') {
      const n = Number(String(rest[++i]).replace('%', ''));
      if (!(Number.isFinite(n) && n >= 0)) throw new Error('--buffer wants a percentage.');
      args.buffer = n / 100;
    } else if (rest[i] === '--tiers') {
      args.tiers = String(rest[++i]).split(',').map((pair) => {
        const [name, pct] = pair.split('=');
        const n = Number(pct);
        if (!name?.trim() || !Number.isFinite(n)) {
          throw new Error(`--tiers wants "Tier=percent" pairs — "${pair}" is not one.`);
        }
        return { name: name.trim(), rate: n / 100 };
      });
    } else throw new Error(`Unknown argument ${rest[i]}`);
  }
  if (!args.input || !args.output) {
    throw new Error('usage: madison.mjs <master.xlsx> <out.csv> [--buffer 5] '
      + '[--tiers "Distributor=8,Shop=12,Club=18"]');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { classifyProduct } = await loadClassifier();

  const wb = XLSX.read(readFileSync(args.input), { type: 'buffer' });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const { rows, repeated, conflicting } =
    readMaster(grid, args, (p) => classifyProduct(p));

  const columns = ['Name', 'SKU', 'Brand', 'Category', 'Our cost',
    ...args.tiers.map((t) => t.name), 'Retail'];
  // A byte-order mark, so a reader with no encoding to go on does not guess
  // latin-1 and turn the Ø in "41 mm Ø bearing" into mojibake.
  writeFileSync(args.output, '﻿' + toCsv(columns, rows));

  const unpriced = rows.filter((r) => !r['Our cost']);
  console.error(
    `${rows.length} parts · ${repeated.length} repeat listings folded in · `
    + `${new Set(rows.map((r) => r.Category).filter(Boolean)).size} collections · `
    + `cost = Madison quote + ${(args.buffer * 100).toFixed(0)}% · `
    + args.tiers.map((t) => `${t.name} +${(t.rate * 100).toFixed(0)}%`).join(', '));

  if (unpriced.length) {
    console.error(`  ! ${unpriced.length} Madison have not priced yet: `
      + `${unpriced.map((r) => r.SKU).join(', ')}. They import with their RRP and `
      + 'no trade price, so they are in the catalogue and cannot be sold until '
      + 'one arrives.');
  }
  if (conflicting.length) {
    console.error(`  ! ${conflicting.length} listed twice at different prices: `
      + `${conflicting.join(', ')}. The first was kept — check which is right.`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
