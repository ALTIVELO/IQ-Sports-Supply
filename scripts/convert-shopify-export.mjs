#!/usr/bin/env node
/**
 * Turns a Shopify product export into a CSV the Import screen can read.
 *
 *   node scripts/convert-shopify-export.mjs <in.csv> <out.csv> \
 *     --markup "Distributor=10,Shop=15,Club=20" [--retail-from-rrp] [--prefix DRAG]
 *
 * A Shopify export is a catalogue of things to sell, not a trade price list: it
 * carries a retail price and a cost, no tier prices at all, and often no SKUs —
 * Shopify is happy to identify a product by its URL handle. So the handle
 * becomes the SKU, prefixed so it cannot collide with a part number, and the
 * tier prices are worked out from the cost.
 *
 * Nothing is invented. A row the export cannot price comes through named and
 * filed with its price columns empty, because a product we list but have not
 * priced is a real state — the supplier's own list says ASK against two of
 * them — and quietly dropping it would hide that.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** A CSV reader that survives quoted fields containing commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const body = text.replace(/^﻿/, '');

  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v ?? '')) && n > 0 ? n : null;
};

/** A product name out of a spreadsheet arrives with the line breaks still in. */
const tidy = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Shopify's own product types, mapped onto our catalogue.
 *
 * Longest match first, so "E-Gravel" is an electric bike rather than a gravel
 * one and "Road Junior" is a road bike rather than whatever "Junior" alone
 * would catch.
 */
const CATEGORIES = [
  [/^e-/i, 'e-bikes'],
  [/junior \d+|^junir/i, 'kids-bikes'],
  [/frameset/i, null],            // decided by the model name instead
  [/road junior/i, 'road-bikes'],
  [/cyclo\s*cross|gravel/i, 'gravel-bikes'],
  [/track/i, 'track-bikes'],
  [/road/i, 'road-bikes'],
  [/downhill|enduro|trail|hardtail|dirt|fatbike|mtb|atb/i, 'mountain-bikes'],
  [/urban|comfort/i, 'hybrid-bikes'],
];

/** A frameset is filed with the frames, under whichever discipline it is. */
const FRAME_CATEGORIES = [
  [/track/i, 'track-bikes'],       // no track-frames collection exists
  [/gravel|sterrato/i, 'gravel-frames'],
  [/road|celerra|firebird|volta/i, 'road-frames'],
  [/./, 'mountain-frames'],
];

function categoryFor(type, name) {
  if (/frameset/i.test(name)) {
    return FRAME_CATEGORIES.find(([re]) => re.test(`${type} ${name}`))[1];
  }
  const hit = CATEGORIES.find(([re, slug]) => slug && re.test(type));
  return hit ? hit[1] : '';
}

function parseArgs(argv) {
  const args = { markup: [], retailFromRrp: false, prefix: 'DRAG', currency: 'GBP' };
  const [input, output, ...rest] = argv;
  args.input = input; args.output = output;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--markup') {
      args.markup = rest[++i].split(',').map((pair) => {
        const [name, pct] = pair.split('=');
        return { name: name.trim(), rate: Number(pct) / 100 };
      });
    } else if (rest[i] === '--retail-from-rrp') args.retailFromRrp = true;
    else if (rest[i] === '--prefix') args.prefix = rest[++i];
    else if (rest[i] === '--currency') args.currency = rest[++i].toUpperCase();
    else throw new Error(`Unknown argument ${rest[i]}`);
  }
  if (!args.input || !args.output || !args.markup.length) {
    throw new Error('usage: convert-shopify-export.mjs <in.csv> <out.csv> '
      + '--markup "Distributor=10,Shop=15,Club=20" [--retail-from-rrp] [--prefix DRAG]');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = parseCsv(readFileSync(args.input, 'utf8'));

  const notes = { uncosted: [], duplicates: [], uncategorised: [] };
  const seen = new Map();
  const out = [];

  for (const r of source) {
    const handle = tidy(r.Handle);
    if (!handle) continue;

    const name = tidy(r.Title) || handle;
    const cost = money(r['Cost per item']);
    const rrp = money(r['Variant Price']);

    // Shopify identifies a product by its handle where there is no SKU. The
    // prefix keeps a URL slug from ever colliding with a real part number.
    let sku = `${args.prefix}-${handle}`.toUpperCase();
    const before = seen.get(sku);
    if (before) {
      // Two builds sharing one handle. Both are kept — dropping one would lose
      // a product — but they need telling apart by somebody who knows which is
      // which, so the suffix is deliberately ugly.
      seen.set(sku, before + 1);
      notes.duplicates.push(`${sku} (${before + 1} rows share this handle)`);
      sku = `${sku}-${before + 1}`;
    } else {
      seen.set(sku, 1);
    }

    const category = categoryFor(r.Type ?? '', name);
    if (!category) notes.uncategorised.push(sku);
    if (cost === null) notes.uncosted.push(`${sku} — ${name}`);

    const row = {
      Name: name,
      SKU: sku,
      Brand: tidy(r.Vendor) || '',
      Category: category,
      // A column, not a footnote: every figure on this row is in it, and the
      // importer sets the product's currency from it. Nothing is converted
      // anywhere, so a list in the supplier's own money stays in it.
      Currency: args.currency,
      'Our cost': cost === null ? '' : cost.toFixed(2),
    };
    for (const tier of args.markup) {
      row[tier.name] = cost === null ? '' : (cost * (1 + tier.rate)).toFixed(2);
    }
    row.Retail = args.retailFromRrp && rrp !== null ? rrp.toFixed(2) : '';
    // Carried through untouched: the export is where the pictures come from,
    // and a column dropped here is a catalogue of grey placeholders.
    row['Image URL'] = tidy(r['Image Src']);

    out.push(row);
  }

  const header = ['Name', 'SKU', 'Brand', 'Category', 'Currency', 'Our cost',
    ...args.markup.map((t) => t.name), 'Retail', 'Image URL'];
  const csv = [header.join(','),
    ...out.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
  // Byte-order mark: without it both Excel and the importer's own reader fall
  // back to a legacy codepage, and every accented character arrives as mojibake.
  writeFileSync(args.output, '﻿' + csv, 'utf8');

  // ── what happened ──
  const priced = out.filter((r) => r['Our cost'] !== '');
  console.log(`${out.length} products written to ${args.output}`);
  console.log(`  columns: ${header.join(' · ')}`);
  console.log(`  ${priced.length} costed, ${out.length - priced.length} without a cost`);
  console.log(`  every figure in ${args.currency}`);
  for (const tier of args.markup) {
    console.log(`  ${tier.name.padEnd(12)} cost + ${(tier.rate * 100).toFixed(0)}%`);
  }
  console.log(`  ${out.filter((r) => r.Retail !== '').length} with a retail price`);
  console.log(`  ${out.filter((r) => r['Image URL'] !== '').length} with an image`);

  if (notes.uncosted.length) {
    console.log(`\n  no cost in the export, so no prices (listed, not orderable):`);
    for (const u of notes.uncosted) console.log(`      ${u}`);
  }
  if (notes.duplicates.length) {
    console.log(`\n  ⚠ ${notes.duplicates.length} duplicate handle(s), suffixed to keep both:`);
    for (const d of [...new Set(notes.duplicates)]) console.log(`      ${d}`);
  }
  if (notes.uncategorised.length) {
    console.log(`\n  ⚠ ${notes.uncategorised.length} could not be filed: `
      + notes.uncategorised.slice(0, 10).join(', '));
  }

  const byCategory = {};
  for (const r of out) byCategory[r.Category || '(none)'] = (byCategory[r.Category || '(none)'] ?? 0) + 1;
  console.log('\ncategories:');
  for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
