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
const OUT_COLUMNS = [
  'Name', 'SKU', 'Brand', 'Series', 'Model', 'Size', 'Category', 'Image', ...PRICES,
];

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
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node scripts/shimano/rebuild.mjs <in.csv> [out.csv]');
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

  const out = built.map((r) => ({
    Name: r.name, SKU: r.sku, Brand: r.brand,
    Series: r.series ?? '', Model: r.model ?? '', Size: r.size ?? '',
    Category: r.category, Image: imageFor(r),
    ...r.prices,
  }));

  const csv = toCsv(OUT_COLUMNS, out);
  // A byte-order mark, so a reader with no encoding to go on does not guess
  // latin-1 and turn an em dash into mojibake in a product name.
  if (output) writeFileSync(resolve(output), '\uFEFF' + csv);
  else process.stdout.write(csv);

  // To stderr, so piping the sheet somewhere still gets you the sheet.
  const groups = new Set(built.filter((r) => r.model).map((r) => r.model));
  const grouped = built.filter((r) => r.model).length;
  const withImage = out.filter((r) => r.Image).length;
  console.error(
    `${out.length} rows · ${grouped} of them in ${groups.size} models · ` +
    `${out.length - grouped} sold on their own · ` +
    `${new Set(built.map((r) => r.series).filter(Boolean)).size} series · ` +
    `${withImage} with a photograph`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
