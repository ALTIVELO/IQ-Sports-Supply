#!/usr/bin/env node
/**
 * Builds one CSV for the Import screen from JMM's several price lists.
 *
 *   node scripts/build-price-list.mjs \
 *     --cost  "JMM Shimano Prices.xlsx" \
 *     --tier  "Distributor=JMM Distributor Price List.xlsx" \
 *     --tier  "Shop=JMM Shop & Elite Team Price List.xlsx" \
 *     --tier  "Club=JMM Club Price List.xlsx" \
 *     --retail-from-srp \
 *     --out   catalogue.csv
 *
 * The supplier sends one workbook per audience, each a printed price list
 * rather than a data file, plus a separate working sheet holding what we
 * ourselves pay. The Import screen wants the opposite shape: one row per SKU
 * with a column for our cost and a column per tier. This joins them.
 *
 *   Name, SKU, Brand, Category, Our cost, Distributor, Shop, Club, Retail
 *
 * Two things it deliberately does not do. It never invents a price: a SKU a
 * list does not mention is left blank in that column, and the importer then
 * leaves that tier alone rather than pricing it at a guess. And it never
 * invents a specification: where the supplier gives no description the name is
 * built from the part code and the section it sat under, so a rotor whose size
 * is encoded in a suffix we cannot decode reads as "Shimano Disc Rotor
 * RTCL900LJ" rather than a guessed diameter.
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

// ── the tier lists ──────────────────────────────────────────────────────────

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

/**
 * What a bundle row is, from its description.
 *
 * A bundle carries no part code, so it needs one built — and the same bundle
 * has to come out with the same code from all three tier lists and from the
 * cost workbook, which describes it differently again. The distributor list
 * calls these R9200 and R8100; the shop and club lists call the same two
 * bundles R9270 and R8170, after the shifters. The group's name is the one
 * thing all four agree on, so that is what decides, with the model numbers
 * only as a fallback.
 */
function bundleKey(description) {
  const series = /dura[\s-]*ace|R92\d\d/i.test(description) ? 'R9200'
               : /ultegra|R81\d\d/i.test(description) ? 'R8100'
               : description.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
  const variant = /power/i.test(description) ? 'PM'
                : /rotor/i.test(description) ? 'RT'
                : 'STD';
  const cassette = description.match(/(\d{2})-(\d{2})T/i);
  return {
    series, variant,
    sku: ['BUNDLE', series, variant, cassette ? `${cassette[1]}${cassette[2]}` : null]
      .filter(Boolean).join('-'),
  };
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

const money = (text) => {
  const n = Number(String(text).replace(/[^0-9.\-]/g, ''));
  return /\d/.test(String(text)) && Number.isFinite(n) ? n : null;
};

/** One tier's list, as a map of SKU to what that tier pays, plus the product. */
function readTierList(path, classifyProduct, notes) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const out = new Map();

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
        if (hit) section = hit;
        continue;
      }
      if (isColumnHeader(cells)) continue;

      const amount = money(price);
      if (amount === null) continue;

      const name = description
        ? tidy(description)
        // No description at all. Say what it is from the section it sat under
        // and leave the supplier's code visible, rather than inventing a size.
        : section?.noun ? `Shimano ${section.noun} ${code}` : code;

      const bundle = code ? null : bundleKey(name);
      const sku = code || bundle.sku;

      if (out.has(sku)) {
        // The Di2 battery, charger and cables are listed under both groupsets.
        // Dropping the repeat is right only while both say the same price; a
        // genuine disagreement is a fault in the sheet and must be seen.
        const first = out.get(sku);
        if (Math.abs(first.price - amount) > 0.005) {
          notes.conflicts.push(`${path.split('/').pop()}: ${sku} (${first.price} vs ${amount})`);
        }
        continue;
      }

      out.set(sku, {
        sku, name, brand: 'Shimano',
        category: section?.category ?? classifyProduct({ name }) ?? '',
        bundle, price: amount,
      });
    }
  }
  return out;
}

// ── the cost workbook ───────────────────────────────────────────────────────

/**
 * What we pay, out of JMM's own working sheets.
 *
 * Four shapes, because four people built them. The two component sheets are
 * wide, with the real cost in the "Price with MOQ" column and Shimano's RRP
 * beside it; bottom brackets and rotors are bare code-and-price; bulk pads put
 * the code in the middle column. Each is read by what its header says rather
 * than by position, except the rotor sheet, which has no header at all.
 */
function readCosts(path, notes) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const cost = new Map();
  const srp = new Map();
  const bundleCost = new Map();

  const record = (map, sku, value, where) => {
    if (!sku || value === null) return;
    const key = sku.trim();
    if (!key) return;
    const seen = map.get(key);
    if (seen !== undefined && Math.abs(seen - value) > 0.005) {
      notes.conflicts.push(`${where}: ${key} costed twice (${seen} vs ${value})`);
      return;
    }
    map.set(key, value);
  };

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, blankrows: true, defval: '', raw: false,
    }).map((r) => r.map((c) => String(c ?? '').trim()));

    // The two groupset sheets: a build's total cost, under a label.
    if (/groupset$/i.test(sheetName)) {
      const series = /dura/i.test(sheetName) ? 'R9200' : 'R8100';
      for (const cells of grid) {
        const label = cells.find((c) => /^GROUPSET TOTAL/i.test(c));
        if (!label) continue;
        const value = money(cells[cells.indexOf(label) + 1] ?? '');
        const variant = /powermeter/i.test(label) ? 'PM'
                      : /rotors/i.test(label) ? 'RT'
                      : 'STD';
        record(bundleCost, `${series}|${variant}`, value, sheetName);
      }
      continue;
    }

    // The rotor sheet is a bare two-column list with no header of its own.
    if (/^rotors$/i.test(sheetName)) {
      for (const cells of grid) record(cost, cells[0], money(cells[1] ?? ''), sheetName);
      continue;
    }

    // Everything else names its columns. Find them rather than assume them.
    //
    // The header row is the one naming the code column. "Price with MOQ" sits
    // on a banner row above it, over the column it labels, and must not be
    // mistaken for the header itself — do that and SRP, which is only on the
    // real header row, is never found.
    let headerRow = grid.findIndex((cells) => cells.some((c) => /^(code|sku)$/i.test(c)));
    if (headerRow < 0) {
      headerRow = grid.findIndex((cells) => cells.some((c) => /price with moq/i.test(c)));
    }
    if (headerRow < 0) { notes.unreadSheets.push(sheetName); continue; }

    const header = grid[headerRow];
    const above = headerRow > 0 ? grid[headerRow - 1] : [];
    const find = (row, re) => row.findIndex((c) => re.test(c));

    const codeCol = Math.max(find(header, /^(code|sku)$/i), 0);
    const srpCol = find(header, /^srp$/i);
    let costCol = find(above, /price with moq/i);
    if (costCol < 0) costCol = find(header, /^(cost|price)/i);
    if (costCol < 0) { notes.unreadSheets.push(sheetName); continue; }

    for (const cells of grid.slice(headerRow + 1)) {
      const sku = cells[codeCol] ?? '';
      if (!sku || /^(code|sku)$/i.test(sku)) continue;
      record(cost, sku, money(cells[costCol] ?? ''), sheetName);
      if (srpCol >= 0) record(srp, sku, money(cells[srpCol] ?? ''), sheetName);
    }
  }

  return { cost, srp, bundleCost };
}

// ── output ──────────────────────────────────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function parseArgs(argv) {
  const args = { tiers: [], retailFromSrp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cost') args.cost = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--retail-from-srp') args.retailFromSrp = true;
    else if (a === '--tier') {
      const [name, ...rest] = argv[++i].split('=');
      args.tiers.push({ name: name.trim(), path: rest.join('=') });
    } else throw new Error(`Unknown argument ${a}`);
  }
  if (!args.cost || !args.out || !args.tiers.length) {
    throw new Error('usage: build-price-list.mjs --cost <x.xlsx> --tier "Name=<y.xlsx>" … '
      + '[--retail-from-srp] --out <out.csv>');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { classifyProduct } = await loadClassifier();
  const notes = { conflicts: [], unreadSheets: [] };

  const lists = args.tiers.map((t) => ({
    ...t, rows: readTierList(t.path, classifyProduct, notes),
  }));
  const { cost, srp, bundleCost } = readCosts(args.cost, notes);

  // The product itself comes from whichever list mentions it first; the lists
  // carry the same catalogue, so this only decides whose wording wins.
  const products = new Map();
  for (const list of lists) {
    for (const [sku, row] of list.rows) {
      if (!products.has(sku)) products.set(sku, { ...row, prices: {} });
      products.get(sku).prices[list.name] = row.price;
    }
  }

  const tierNames = lists.map((l) => l.name);
  const retail = args.retailFromSrp ? 'Retail' : null;
  const header = ['Name', 'SKU', 'Brand', 'Category', 'Our cost', ...tierNames,
    ...(retail ? [retail] : [])];

  const out = [];
  const stats = { costed: 0, uncosted: [], retailed: 0, belowCost: [] };

  for (const p of products.values()) {
    const ourCost = p.bundle
      ? bundleCost.get(`${p.bundle.series}|${p.bundle.variant}`)
      : cost.get(p.sku);

    if (ourCost === undefined) stats.uncosted.push(p.sku); else stats.costed += 1;

    const rrp = retail ? srp.get(p.sku) : undefined;
    if (rrp !== undefined) stats.retailed += 1;

    // Worth knowing before it reaches the site, though the Import screen
    // checks for it again on the way in.
    if (ourCost !== undefined) {
      for (const [tier, price] of Object.entries(p.prices)) {
        if (price <= ourCost) stats.belowCost.push(`${p.sku} ${tier} ${price} vs cost ${ourCost}`);
      }
    }

    out.push({
      Name: p.name, SKU: p.sku, Brand: p.brand, Category: p.category,
      'Our cost': ourCost === undefined ? '' : ourCost.toFixed(2),
      ...Object.fromEntries(tierNames.map((t) =>
        [t, p.prices[t] === undefined ? '' : p.prices[t].toFixed(2)])),
      ...(retail ? { [retail]: rrp === undefined ? '' : rrp.toFixed(2) } : {}),
    });
  }

  const csv = [header.join(','),
    ...out.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
  // Byte-order mark: without it both Excel and the importer's own reader fall
  // back to a legacy codepage, and every em-dash in a product name arrives as
  // mojibake — which then goes into the catalogue under that name.
  writeFileSync(args.out, '﻿' + csv, 'utf8');

  // ── what happened ──
  console.log(`${out.length} products written to ${args.out}`);
  console.log(`  columns: ${header.join(' · ')}`);
  for (const list of lists) {
    const priced = out.filter((r) => r[list.name] !== '').length;
    console.log(`  ${String(list.name).padEnd(12)} ${priced} priced`);
  }
  console.log(`  ${'Our cost'.padEnd(12)} ${stats.costed} costed`
    + (stats.uncosted.length ? `, ${stats.uncosted.length} without a cost` : ''));
  if (retail) console.log(`  ${'Retail'.padEnd(12)} ${stats.retailed} from Shimano's SRP`);

  if (stats.uncosted.length) {
    console.log(`\n  no cost found for: ${stats.uncosted.slice(0, 30).join(', ')}`
      + (stats.uncosted.length > 30 ? `, and ${stats.uncosted.length - 30} more` : ''));
    console.log('  Those columns are left blank; the importer prices the tiers and');
    console.log('  leaves the cost alone, so nothing is invented.');
  }
  if (stats.belowCost.length) {
    console.log(`\n  ⚠ ${stats.belowCost.length} price(s) at or below what we pay:`);
    for (const b of stats.belowCost.slice(0, 20)) console.log(`      ${b}`);
  }
  if (notes.unreadSheets.length) {
    console.log(`\n  ⚠ sheets whose columns could not be identified, so no cost was `
      + `taken from them: ${notes.unreadSheets.join(', ')}`);
  }
  if (notes.conflicts.length) {
    console.log(`\n  ⚠ ${notes.conflicts.length} disagreement(s) within the source files:`);
    for (const c of notes.conflicts) console.log(`      ${c}`);
    console.log('      Check the supplier sheets — one of each pair is wrong.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
