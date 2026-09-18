#!/usr/bin/env node
/**
 * Turns a Shopify product export into a sheet the Import screen can read.
 *
 *   node scripts/vision/rebuild.mjs <in.csv> <out.csv> \
 *     --price-is cost --markup "Distributor=10,Shop=15,Club=20" \
 *     [--category wheels] [--currency GBP]
 *
 * `--price-is` has no default, and that is the point. A Shopify export calls
 * its one price column "Variant Price" whatever the number in it actually is —
 * a retail price, a dealer price, a landed cost — and the file carries nothing
 * that says which. Guessing is the one mistake here worth guarding against: a
 * selling price filed as a cost makes every margin in the business look
 * healthy, and nothing downstream ever questions it.
 *
 * So the column is named on the command line by somebody who knows. Name it
 * `cost` and the tiers are worked out from it at the markups given; name a
 * tier and the figure goes in that column alone, with the rest left blank,
 * because there is no way to derive a cost from one selling price.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { flattenShopify } from './classify.mjs';

const TIERS = ['Distributor', 'Shop', 'Club', 'Retail'];
const COLUMNS = [
  'Name', 'SKU', 'Brand', 'Series', 'Model', 'Size', 'Category', 'Image',
  'Currency', 'Our cost', ...TIERS,
];

/** A CSV reader that survives quoted fields holding commas and newlines. */
export function parseCsv(text) {
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

  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const cell = (v) => {
  const s = String(v ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (columns, rows) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))]
    .join('\n') + '\n';

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseArgs(argv) {
  const [input, output, ...rest] = argv;
  const args = { input, output, markup: [], category: '', currency: 'GBP', priceIs: null };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--price-is') args.priceIs = rest[++i].trim().toLowerCase();
    else if (rest[i] === '--markup') {
      args.markup = rest[++i].split(',').map((pair) => {
        const [name, pct] = pair.split('=');
        return { name: name.trim(), rate: Number(pct) / 100 };
      });
    } else if (rest[i] === '--category') args.category = rest[++i];
    else if (rest[i] === '--currency') args.currency = rest[++i].toUpperCase();
    else throw new Error(`Unknown argument ${rest[i]}`);
  }

  const columns = ['cost', ...TIERS.map((t) => t.toLowerCase())];
  if (!args.input || !args.output || !args.priceIs) {
    throw new Error('usage: rebuild.mjs <in.csv> <out.csv> --price-is '
      + `<${columns.join('|')}> [--markup "Distributor=10,Shop=15,Club=20"] `
      + '[--category wheels] [--currency GBP]');
  }
  if (!columns.includes(args.priceIs)) {
    throw new Error(`--price-is must be one of ${columns.join(', ')} — `
      + `"${args.priceIs}" is not a column on our price list.`);
  }
  if (args.priceIs === 'cost' && !args.markup.length) {
    throw new Error('--price-is cost needs --markup, or the tiers come out empty.');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = parseCsv(readFileSync(args.input, 'utf8'));
  const built = flattenShopify(source);

  const out = built.map((r) => {
    const price = money(r.price);
    const row = {
      Name: r.name, SKU: r.sku, Brand: r.brand,
      Series: r.series ?? '', Model: r.model ?? '', Size: r.size ?? '',
      Category: args.category, Image: r.image,
      Currency: args.currency,
      'Our cost': '', Distributor: '', Shop: '', Club: '', Retail: '',
    };
    if (price === null) return row;

    if (args.priceIs === 'cost') {
      row['Our cost'] = price.toFixed(2);
      for (const { name, rate } of args.markup) {
        if (TIERS.includes(name)) row[name] = (price * (1 + rate)).toFixed(2);
      }
    } else {
      // One selling price says nothing about what we pay or what any other
      // tier pays, so the rest stay empty rather than being made up.
      const column = TIERS.find((t) => t.toLowerCase() === args.priceIs);
      row[column] = price.toFixed(2);
    }
    return row;
  });

  const csv = toCsv(COLUMNS, out);
  if (args.output) writeFileSync(args.output, csv); else process.stdout.write(csv);

  const models = new Set(out.filter((r) => r.Model).map((r) => r.Model));
  const unpriced = out.filter((r) => !COLUMNS.slice(9).some((c) => r[c]));
  // To stderr, so piping the sheet somewhere still gets you the sheet.
  console.error(
    `${out.length} SKUs · ${models.size} model${models.size === 1 ? '' : 's'} · `
    + `${out.length - models.size ? out.filter((r) => r.Model).length : 0} of them in a range · `
    + `${new Set(out.map((r) => r.Series).filter(Boolean)).size} series · `
    + `${out.filter((r) => r.Image).length} with a photograph · `
    + `${args.priceIs === 'cost' ? 'tiers from cost' : `price filed as ${args.priceIs}`}`
    + (unpriced.length ? ` · ${unpriced.length} with no price` : ''));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
