#!/usr/bin/env node
/**
 * Turns a JMM distributor price list (.xlsx) into a CSV the Import screen can
 * read in one pass.
 *
 *   node scripts/convert-price-list.mjs <in.xlsx> <out.csv>
 *
 * The supplier's sheet is a printed price list rather than a data file: one
 * column block, a title row, a section heading every so often, the column
 * headers repeated under each heading, and whole sections where the
 * description column is simply empty. This flattens all of that into
 *
 *   name,sku,price,brand,category
 *
 * Two things are worth knowing about what it does NOT do. It never invents a
 * specification: where the supplier gives no description, the name is built
 * from the part code and the section it sat under, so a rotor whose size is
 * encoded in a suffix we cannot decode reads as "Shimano Disc Rotor RTCL900LJ"
 * rather than a guessed diameter. And it never guesses a category for the
 * component sections — those go through the same classifier the site uses, so
 * the CSV and the site can never disagree.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The site's own classifier, compiled on the fly so there is one copy of it. */
async function loadClassifier() {
  const out = mkdtempSync(join(tmpdir(), 'iq-classify-'));
  execFileSync('npx', ['tsc', join(root, 'src/lib/catalogue/categories.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'bundler', '--skipLibCheck'], { stdio: 'ignore' });
  return import(join(out, 'categories.js'));
}

// A section heading tells us what everything under it is, which is the only
// thing that rescues the blocks with no descriptions at all.
const SECTIONS = [
  { match: /BOTTOM BRACKETS/i,           category: 'bottom-brackets', noun: 'Bottom Bracket' },
  { match: /BULK BRAKE PADS/i,           category: 'brake-pads',      noun: 'Brake Pads' },
  { match: /^ROTORS$/i,                  category: 'rotors',          noun: 'Disc Rotor' },
  { match: /COMPLETE GROUPSET BUNDLES/i, category: 'groupsets',       noun: 'Groupset' },
  // Mixed blocks: shifters, mechs, chainsets, cassettes, chains, batteries.
  // Each row is classified on its own description.
  { match: /—\s*COMPONENTS$/i,           category: null,              noun: null },
];

const isColumnHeader = (cells) =>
  /^(code|sku|part)/i.test(cells[0] ?? '') && /^(description|name)/i.test(cells[1] ?? '');

/** A bundle row carries no part code, so one is built from what it is. */
function bundleSku(description) {
  const series = /R9200/i.test(description) ? 'R9200'
               : /R8100/i.test(description) ? 'R8100'
               : description.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
  const variant = /power/i.test(description) ? 'PM'
                : /rotor/i.test(description) ? 'RT'
                : 'STD';
  const cassette = description.match(/(\d{2})-(\d{2})T/i);
  return ['BUNDLE', series, variant, cassette ? `${cassette[1]}${cassette[2]}` : null]
    .filter(Boolean).join('-');
}

/**
 * The supplier's brackets are not always balanced — one row ends "(RTCL900"
 * with nothing closing it, another ends "11-30T)" with nothing opening it.
 * Balance them and change nothing else; this is punctuation, not content.
 */
function tidy(text) {
  let s = text.replace(/\s{2,}/g, ' ').trim();
  const opens = (s.match(/\(/g) ?? []).length;
  const closes = (s.match(/\)/g) ?? []).length;
  if (opens > closes) s += ')'.repeat(opens - closes);
  else if (closes > opens) {
    for (let i = 0; i < closes - opens; i++) s = s.replace(/\)(?=[^)]*$)/, '');
  }
  return s.trim();
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: convert-price-list.mjs <in.xlsx> <out.csv>');
    process.exit(1);
  }

  const { classifyProduct } = await loadClassifier();
  const wb = XLSX.read(readFileSync(input), { type: 'buffer' });
  const rows = [];
  const notes = { noDescription: 0, generatedSku: 0, duplicates: [], conflicts: [], skipped: 0 };
  const seen = new Map();

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, blankrows: true, defval: '', raw: false,
    }).map((r) => r.map((c) => String(c ?? '').trim()));

    let section = null;

    for (const cells of grid) {
      const [code, description, price] = [cells[0] ?? '', cells[1] ?? '', cells[2] ?? ''];
      if (!code && !description && !price) continue;

      // A heading fills one cell and prices nothing.
      if (code && !description && !price) {
        const hit = SECTIONS.find((s) => s.match.test(code));
        if (hit) { section = hit; notes.skipped++; continue; }
        // The title row, or a heading we do not recognise: no price, so it is
        // not a product either way.
        notes.skipped++;
        continue;
      }
      if (isColumnHeader(cells)) { notes.skipped++; continue; }

      const amount = Number(String(price).replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(amount) || !/\d/.test(price)) { notes.skipped++; continue; }

      const name = description
        ? tidy(description)
        // No description at all. Say what it is from the section it sat under
        // and leave the supplier's code visible, rather than inventing a size.
        : section?.noun ? `Shimano ${section.noun} ${code}` : code;
      if (!description) notes.noDescription++;

      let sku = code;
      if (!sku) { sku = bundleSku(name); notes.generatedSku++; }

      if (seen.has(sku)) {
        // The Di2 battery, charger and cables are listed under both groupsets.
        // Dropping the repeat is right only while both say the same price; a
        // genuine disagreement is a fault in the sheet and must be seen.
        const first = seen.get(sku);
        if (first !== amount) notes.conflicts.push(`${sku} (${first} vs ${amount})`);
        else notes.duplicates.push(sku);
        continue;
      }
      seen.set(sku, amount);

      const category = section?.category ?? classifyProduct({ name }) ?? '';

      rows.push({ sku, name, brand: 'Shimano', category, price: amount.toFixed(2) });
    }
  }

  // Ordered for reading rather than for the importer, which matches columns by
  // their heading wherever they sit: name first, then the code and the money.
  const header = ['name', 'sku', 'price', 'brand', 'category'];
  const csv = [header.join(','),
    ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
  // Byte-order mark: without it both Excel and the importer's own reader fall
  // back to a legacy codepage, and every em-dash in a product name arrives as
  // mojibake — which then goes into the catalogue under that name.
  writeFileSync(output, '\uFEFF' + csv, 'utf8');

  const byCategory = {};
  for (const r of rows) byCategory[r.category || '(none)'] = (byCategory[r.category || '(none)'] ?? 0) + 1;

  console.log(`${rows.length} products written to ${output}`);
  console.log(`  ${notes.skipped} structural rows skipped (title, headings, repeated headers)`);
  console.log(`  ${notes.noDescription} had no description; named from their code and section`);
  console.log(`  ${notes.generatedSku} had no part code; a SKU was generated`);
  if (notes.duplicates.length) {
    console.log(`  ${notes.duplicates.length} repeated code(s) dropped, each priced the same both times: ${[...new Set(notes.duplicates)].join(', ')}`);
  }
  if (notes.conflicts.length) {
    console.log(`\n  ⚠ ${notes.conflicts.length} code(s) appear twice at DIFFERENT prices and were dropped:`);
    for (const c of notes.conflicts) console.log(`      ${c}`);
    console.log('      Check the supplier sheet — one of the two is wrong.');
  }
  console.log('\ncategories:');
  for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(18)} ${v}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
