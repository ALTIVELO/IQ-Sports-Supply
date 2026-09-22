#!/usr/bin/env node
/**
 * Reads the outer quantities, and the price for buying fewer than one, out of
 * the supplier's groupset workbook.
 *
 *   node scripts/shimano/outers.mjs <workbook.xlsx> [out.json] \
 *     [--below-outer higher|lower]
 *
 * Shimano sell by the outer — the carton a part ships in, ten shifters or a
 * hundred charging cables — and the price we advertise is the price at that
 * quantity. Below it the part still exists and still has a price, a worse one,
 * and the sheet we publish has to carry both or a customer ordering three of
 * something finds out at invoice time.
 *
 * The workbook holds, per part:
 *
 *   Outer                 the carton quantity, which is the MOQ for the
 *                         advertised price;
 *   two loose-unit prices  side by side, headed by a number that changes per
 *                         range (1400 and 1200 on Dura-Ace, 850 and 750 on
 *                         Ultegra) — the second is the first scaled by the
 *                         ratio of those two numbers, exactly, on every row;
 *   Price By the Outer    what we actually pay, and what our published prices
 *                         are already built from.
 *
 * Which of the two loose-unit columns applies to us is a commercial fact the
 * workbook does not state, so --below-outer names it rather than this script
 * guessing. It defaults to the dearer of the two because that is the one that
 * cannot lose money if the guess is wrong: a below-outer price set too high
 * costs a sale and is visible, one set too low costs margin on every line and
 * is not.
 *
 * Sheets with no Outer column — bottom brackets, rotors, bulk pads — are
 * bought and sold in ones. They contribute nothing here, which leaves them at
 * an MOQ of one, which is correct.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const norm = (v) => String(v ?? '').trim().toLowerCase();
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Where the columns are on a sheet that has them.
 *
 * Found by reading the header rather than by counting from the left, because
 * the two ranges are laid out differently — Dura-Ace is thirteen columns wide
 * and Ultegra eleven — and a column index hard-coded here would silently read
 * the wrong one the first time somebody inserts a column.
 */
export function readHeader(grid) {
  for (let i = 0; i < Math.min(grid.length, 6); i += 1) {
    const row = grid[i] ?? [];
    const code = row.findIndex((c) => norm(c) === 'code');
    const outer = row.findIndex((c) => norm(c) === 'outer');
    if (code < 0 || outer < 0) continue;

    // The two loose-unit prices sit between the SRP and the by-the-outer
    // price, headed by a bare number apiece. That is what identifies them:
    // every other heading on the row is a word.
    const loose = [];
    for (let c = outer + 1; c < row.length; c += 1) {
      if (num(row[c]) !== null && /^[0-9.]+$/.test(String(row[c]).trim())) loose.push(c);
    }
    return { code, outer, loose, row: i };
  }
  return null;
}

/**
 * The column above which the sheet says "Price By the Outer".
 *
 * That label lives on the row above the headings, so it is looked for over the
 * whole top of the sheet rather than on one known row.
 */
export function byTheOuterColumn(grid) {
  for (let i = 0; i < Math.min(grid.length, 6); i += 1) {
    const at = (grid[i] ?? []).findIndex((c) => /price\s*by\s*the\s*outer/i.test(String(c ?? '')));
    if (at >= 0) return at;
  }
  return -1;
}

export function readSheet(grid, { below = 'higher' } = {}) {
  const head = readHeader(grid);
  if (!head || head.loose.length === 0) return [];
  const outerPriceAt = byTheOuterColumn(grid);

  // Dearest first, so "higher" and "lower" mean what they say whichever order
  // the sheet happens to list them in.
  const ordered = [...head.loose];
  const pick = below === 'lower' ? ordered[ordered.length - 1] : ordered[0];

  const out = [];
  for (const row of grid.slice(head.row + 1)) {
    const sku = String(row?.[head.code] ?? '').trim().toUpperCase();
    const outer = num(row?.[head.outer]);
    // A totals line has a figure but no code; a spacer has neither.
    if (!sku || !outer) continue;
    out.push({
      sku,
      outer: Math.round(outer),
      below: num(row[pick]),
      byTheOuter: outerPriceAt >= 0 ? num(row[outerPriceAt]) : null,
    });
  }
  return out;
}

export function readWorkbook(wb, opts) {
  const found = new Map();
  const sheets = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1, blankrows: false, defval: '',
    });
    const rows = readSheet(grid, opts);
    if (!rows.length) { sheets.push({ name, rows: 0 }); continue; }
    sheets.push({ name, rows: rows.length });
    for (const r of rows) {
      /*
       * A part can appear on more than one range's sheet — a charging cable is
       * sold with Dura-Ace and with Ultegra — at the same outer and a
       * different loose price. Keeping the dearer is the same choice as
       * --below-outer higher, made again: the one that cannot cost margin.
       */
      const seen = found.get(r.sku);
      if (!seen) { found.set(r.sku, r); continue; }
      if ((r.below ?? 0) > (seen.below ?? 0)) found.set(r.sku, { ...r, alsoOn: true });
      else found.set(r.sku, { ...seen, alsoOn: true });
    }
  }
  return { skus: found, sheets };
}

function main() {
  const [input, output, ...rest] = process.argv.slice(2);
  let below = 'higher';
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--below-outer') below = rest[++i];
    else throw new Error(`Unknown argument ${rest[i]}`);
  }
  if (!input) {
    throw new Error('usage: outers.mjs <workbook.xlsx> [out.json] '
      + '[--below-outer higher|lower]');
  }
  if (!['higher', 'lower'].includes(below)) {
    throw new Error(`--below-outer is higher or lower, not "${below}".`);
  }

  const wb = XLSX.read(readFileSync(input), { type: 'buffer' });
  const { skus, sheets } = readWorkbook(wb, { below });

  const doc = {
    _source: [
      'Outer quantities and loose-unit prices from the supplier groupset',
      'workbook, read by scripts/shimano/outers.mjs. Sterling, excluding VAT.',
      '',
      'outer  the carton quantity, and so the MOQ for the advertised price.',
      'below  what one unit costs when fewer than an outer are bought —',
      `       the ${below} of the two loose-unit columns on the sheet.`,
      '',
      'A SKU absent from here is sold in ones: MOQ 1, one price at any',
      'quantity. Bottom brackets, rotors and bulk pads are all of them.',
    ],
    belowOuter: below,
    skus: Object.fromEntries([...skus.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sku, r]) => [sku, { outer: r.outer, below: r.below }])),
  };

  const json = JSON.stringify(doc, null, 2) + '\n';
  if (output) writeFileSync(output, json);
  else process.stdout.write(json);

  const withBelow = [...skus.values()].filter((r) => r.below !== null).length;
  console.error(`${skus.size} SKUs with an outer · ${withBelow} with a `
    + `loose-unit price · ${below} of the two columns`);
  for (const s of sheets) {
    console.error(`  ${s.name.trim()}: ${s.rows || 'no outer column — sold in ones'}`
      + (s.rows ? ' with an outer' : ''));
  }
  const noBelow = [...skus.values()].filter((r) => r.below === null);
  if (noBelow.length) {
    console.error(`  ! ${noBelow.length} with an outer but no loose-unit price: `
      + `${noBelow.map((r) => r.sku).join(', ')}. These price the same at any `
      + 'quantity until the supplier gives one.');
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
