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
 * The columns that carry a second price for buying fewer than an outer.
 *
 * Retail is not one of them: it is the manufacturer's recommended price, the
 * number on the box, and it does not change with how many boxes there are.
 *
 * Neither is Our cost. We buy by the outer and ship loose units out of a
 * carton we have already paid the carton price for, so what a part costs us
 * does not change with what a customer takes. The second price is a charge
 * for breaking the box, not a different cost being passed on.
 */
const BY_THE_OUTER = ['Distributor', 'Shop', 'Club'];
export const underOuter = (column) => `${column} under outer`;

/**
 * What breaking a carton adds, per tier.
 *
 * A flat uplift on our own advertised price rather than anything read off the
 * supplier's sheet, because that is what it is: the carton is what we buy and
 * splitting one is work we do. A distributor taking singles is still buying
 * volume across the order, so they pay five; a shop or a team taking one is
 * the case the carton was broken for, so they pay ten.
 */
const LOOSE_UPLIFT = { Distributor: 0.05, Shop: 0.10, Club: 0.10 };

/*
 * Ranges bought and sold in ones, whatever any sheet says.
 *
 * Bottom brackets, brake pads and rotors have no outer price from the
 * supplier and no carton quantity on their sheets — they are stated here as a
 * rule rather than left to be true by accident, so a future workbook that
 * lists a rotor with an outer does not quietly put every rotor behind a
 * minimum.
 */
const NO_OUTER = new Set(['bottom-brackets', 'brake-pads', 'rotors']);

/*
 * Two prices per tier, the loose one first.
 *
 * Left to right is dearest-first, which is the order somebody reads the sheet
 * in: this is what one costs, and this is what one costs if you take the
 * carton. Putting the outer price on the right also leaves the columns that
 * were there before in the order they were in.
 */
const OUT_COLUMNS = [
  'Name', 'SKU', 'Brand', 'Series', 'Model', 'Size', 'Category', 'Image', 'Outer',
  ...PRICES.flatMap((c) => (BY_THE_OUTER.includes(c) ? [underOuter(c), c] : [c])),
];

/**
 * What a tier pays for one loose unit: the advertised price plus the uplift.
 *
 * Deliberately not worked back from what a single costs the supplier. We do
 * not buy singles — we buy the carton and split it — so a price built on a
 * single-unit cost would be a price for a transaction that does not happen.
 */
export function looseTierPrice(outerPrice, uplift) {
  if (!(outerPrice > 0) || !(uplift >= 0)) return null;
  return outerPrice * (1 + uplift);
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

  // Where the supplier prices a single, so a loose sale that has to be bought
  // in rather than split out of stock can be seen for what it costs.
  const singleCost = new Map();

  const out = built.map((r) => {
    // Three ranges are sold in ones by rule, whatever the workbook says.
    const o = NO_OUTER.has(r.category) ? null : outerFor(r.sku);
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
    if (!o || o.outer <= 1) return row;

    for (const column of BY_THE_OUTER) {
      const loose = looseTierPrice(money(r.prices[column]), LOOSE_UPLIFT[column]);
      if (loose !== null) row[underOuter(column)] = loose.toFixed(2);
    }
    // Every part with an outer gets a loose price now, because the uplift is
    // worked out from our own price rather than from a single-unit cost the
    // supplier may not have quoted.
    if (o.below != null) singleCost.set(r.sku, { single: o.below, row });
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
      + `${dumb.length > 6 ? ', …' : ''}. These have no advertised price to `
      + 'uplift from.');
  }

  /*
   * A loose sale we would have to buy in rather than split.
   *
   * The uplift is a charge for breaking a carton we already own. It is not a
   * margin on a single bought from the supplier for the purpose: those cost
   * far more than the carton rate, and on some parts more than the uplifted
   * price we would be charging. Worth knowing by name, because the answer is
   * to order the carton rather than to reprice the part.
   */
  const underwater = [];
  for (const [sku, { single, row }] of singleCost) {
    const sell = Number(row[underOuter('Distributor')]);
    if (Number.isFinite(sell) && sell < single) {
      underwater.push(`${sku} (buy ${single.toFixed(2)}, sell ${sell.toFixed(2)})`);
    }
  }
  if (underwater.length) {
    console.error(`  ! ${underwater.length} would lose money if the loose unit `
      + 'were bought in as a single rather than split out of an outer: '
      + `${underwater.slice(0, 4).join(', ')}`
      + `${underwater.length > 4 ? `, and ${underwater.length - 4} more` : ''}. `
      + 'Order the carton.');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
