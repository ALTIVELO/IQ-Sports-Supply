#!/usr/bin/env node
/**
 * Rebuilds a Shimano price list into a sheet the catalogue can read.
 *
 *   node scripts/shimano/rebuild.mjs <in.csv> [out.csv]
 *
 * In goes the supplier's list: one row per orderable part, named for a picking
 * bay. Out comes the same rows — every SKU, every price, nothing dropped and
 * nothing merged — with four columns added that say what each row is:
 *
 *   Series  the range a shop asks for: Dura-Ace, Ultegra, Di2;
 *   Model   the key that gathers a model's sizes into one catalogue line;
 *   Size    what distinguishes this one from its siblings;
 *   Image   a photograph, where we have one for that model.
 *
 * The rows are the supplier's and stay the supplier's. This adds columns and,
 * for the rows that turn out to be one of a range, rewrites the name into
 * something a customer can read. It never invents a price, never drops a SKU
 * and never merges two.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuildSheet } from './classify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The price columns, in the order a price list puts them. */
const PRICES = ['Our cost', 'Distributor', 'Shop', 'Club', 'Retail'];

/*
 * The columns that have a second price for buying fewer than an outer.
 *
 * Retail is not one of them. It is the manufacturer's recommended price, the
 * number on the box, and it does not change with how many boxes there are.
 */
const BY_THE_OUTER = ['Our cost', 'Distributor', 'Shop', 'Club'];
export const underOuter = (column) => `${column} under outer`;

/*
 * Two prices per tier, the loose one first.
 *
 * Left to right is cheapest-last, which is the order somebody reads the sheet
 * in: this is what one costs, and this is what one costs if you take the
 * carton. Putting the outer price on the right also leaves the columns that
 * were there before in the order they were in.
 */
const OUT_COLUMNS = [
  'Name', 'SKU', 'Brand', 'Series', 'Model', 'Size', 'Category', 'Image', 'Outer',
  ...PRICES.flatMap((c) => (BY_THE_OUTER.includes(c) ? [underOuter(c), c] : [c])),
];

/**
 * What a tier pays for one loose unit.
 *
 * Worked out from the row's own outer price rather than from a markup written
 * down here, so the two prices always sit at the same margin as each other. A
 * sheet whose Distributor price is 8% over cost keeps being 8% over cost when
 * the cost is the loose one, whatever that 8% was and whoever changes it next.
 */
export function looseTierPrice(outerCost, outerPrice, looseCost) {
  if (!(outerCost > 0) || !(outerPrice > 0) || !(looseCost > 0)) return null;
  return looseCost * (outerPrice / outerCost);
}

/**
 * A CSV reader that handles quotes, because a product name can contain a
 * comma and a sheet that splits on every comma turns one into two.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** A field is quoted only where it has to be, so the file stays readable. */
const cell = (v) => {
  const s = String(v ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  return [columns.join(','),
          ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

function main() {
  const [input, output, ...rest] = process.argv.slice(2);
  let outersFile = resolve(HERE, 'outers.json');
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--outers') outersFile = rest[++i];
    else if (rest[i] === '--no-outers') outersFile = null;
    else { console.error(`Unknown argument ${rest[i]}`); process.exit(2); }
  }
  if (!input) {
    console.error('usage: node scripts/shimano/rebuild.mjs <in.csv> [out.csv] '
      + '[--outers outers.json | --no-outers]');
    process.exit(2);
  }

  const [header, ...body] = parseCsv(readFileSync(resolve(input), 'utf8'));
  const at = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const col = Object.fromEntries(
    ['Name', 'SKU', 'Brand', 'Category', ...PRICES].map((c) => [c, at(c)]));

  for (const [name, index] of Object.entries(col)) {
    if (index < 0) { console.error(`The sheet has no "${name}" column.`); process.exit(1); }
  }

  const rows = body.map((r) => ({
    name: (r[col.Name] ?? '').trim(),
    sku: (r[col.SKU] ?? '').trim(),
    brand: (r[col.Brand] ?? '').trim(),
    category: (r[col.Category] ?? '').trim(),
    prices: Object.fromEntries(PRICES.map((p) => [p, (r[col[p]] ?? '').trim()])),
  })).filter((r) => r.sku);

  const built = rebuildSheet(rows);

  const images = JSON.parse(readFileSync(resolve(HERE, 'images.json'), 'utf8'));
  const imageFor = (r) =>
    images.skus?.[r.sku] ?? (r.model ? images.models?.[r.model] : null) ?? '';

  /*
   * The carton a part ships in, and what one costs outside it.
   *
   * Shimano sell by the outer and the prices on this sheet are outer prices,
   * which was true before and written down nowhere. A customer ordering three
   * of a part that comes in tens was being quoted the carton price and
   * corrected at invoice time. Saying the quantity out loud, and carrying the
   * loose price beside the outer one, is the whole of the fix.
   */
  const outers = outersFile
    ? JSON.parse(readFileSync(resolve(outersFile), 'utf8'))
    : { skus: {} };
  const outerFor = (sku) => outers.skus?.[sku.trim().toUpperCase()] ?? null;

  const money = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const out = built.map((r) => {
    const o = outerFor(r.sku);
    const row = {
      Name: r.name, SKU: r.sku, Brand: r.brand,
      Series: r.series ?? '', Model: r.model ?? '', Size: r.size ?? '',
      Category: r.category, Image: imageFor(r),
      // An outer of one is not a minimum, so it is left blank rather than
      // written on every row of a sheet where most parts are sold in ones.
      Outer: o && o.outer > 1 ? String(o.outer) : '',
      ...Object.fromEntries(BY_THE_OUTER.map((c) => [underOuter(c), ''])),
      ...r.prices,
    };
    const outerCost = money(r.prices['Our cost']);
    if (!o || o.below === null || o.below === undefined) return row;

    row[underOuter('Our cost')] = o.below.toFixed(2);
    for (const column of BY_THE_OUTER) {
      if (column === 'Our cost') continue;
      const loose = looseTierPrice(outerCost, money(r.prices[column]), o.below);
      if (loose !== null) row[underOuter(column)] = loose.toFixed(2);
    }
    return row;
  });

  const csv = toCsv(OUT_COLUMNS, out);
  // A byte-order mark, so a reader with no encoding to go on does not guess
  // latin-1 and turn an em dash into mojibake in a product name.
  if (output) writeFileSync(resolve(output), '\uFEFF' + csv);
  else process.stdout.write(csv);

  // To stderr, so piping the sheet somewhere still gets you the sheet.
  const groups = new Set(built.filter((r) => r.model).map((r) => r.model));
  const grouped = built.filter((r) => r.model).length;
  const withImage = out.filter((r) => r.Image).length;
  const withOuter = out.filter((r) => r.Outer).length;
  const withLoose = out.filter((r) => r[underOuter('Distributor')]).length;
  console.error(
    `${out.length} rows · ${grouped} of them in ${groups.size} models · ` +
    `${out.length - grouped} sold on their own · ` +
    `${new Set(built.map((r) => r.series).filter(Boolean)).size} series · ` +
    `${withImage} with a photograph · ` +
    `${withOuter} with an outer, ${withLoose} of those priced loose`);

  /*
   * An outer quantity we have no price to go with, and a price we have no
   * outer for, are both worth saying. The first sells below the carton at the
   * carton price; the second is a part the workbook did not mention, which is
   * either sold in ones or was missed.
   */
  const dumb = out.filter((r) => r.Outer && !r[underOuter('Distributor')]);
  if (dumb.length) {
    console.error(`  ! ${dumb.length} with an outer but no loose price: `
      + `${dumb.slice(0, 6).map((r) => r.SKU).join(', ')}`
      + `${dumb.length > 6 ? ', …' : ''}. These sell at the outer price `
      + 'whatever the quantity, until the supplier prices a single.');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
