'use client';

import * as XLSX from 'xlsx';
import { tierKey, type ColumnMapping } from './types';

export interface ParsedSheet {
  name: string;
  /** Raw grid, blank rows kept so the header-row offset stays meaningful. */
  grid: string[][];
}

/** Reads an .xlsx/.xls/.csv file into a grid per sheet. */
export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  return wb.SheetNames.map((name) => {
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1, blankrows: true, defval: '', raw: false,
    });
    return { name, grid: grid.map((row) => row.map((c) => String(c ?? ''))) };
  });
}

/** Column letters for the widest row in the grid: A, B, … Z, AA … */
export function columnLetters(grid: string[][]): string[] {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  return Array.from({ length: width }, (_, i) => XLSX.utils.encode_col(i));
}

const colIndex = (letter: string) => XLSX.utils.decode_col(letter);

// A column header is a label, not a sentence. Ignoring longer cells stops a
// title block ("IQ Sports Supply — Q4 price list") being read as a header.
const isHeaderish = (cell: string) => {
  const text = cell.trim();
  return text.length > 0 && text.length <= 40 && text.split(/\s+/).length <= 4;
};

/**
 * Guesses which column is which from the header row, so the first-time setup is
 * usually just a confirmation. Header text is matched loosely.
 */
export function guessMapping(header: string[], fields: string[]): ColumnMapping {
  const patterns: Record<string, RegExp> = {
    sku: /\b(sku|code|part\s*(no|number)?|item\s*(code|no)?|product\s*code)\b/i,
    name: /\b(name|description|product|item|title)\b/i,
    brand: /\b(brand|make|manufacturer|supplier)\b/i,
    price: /\b(price|cost|rrp|net|trade|amount|£|gbp)\b/i,
    email: /\b(e-?mail)\b/i,
    tier: /\b(tier|band|level|pricing)\b/i,
    vat_no: /\b(vat)\b/i,
    address: /\b(address|addr)\b/i,
    phone: /\b(phone|tel|mobile|contact\s*number)\b/i,
    location: /\b(location|site|warehouse|depot|branch)\b/i,
    qty: /\b(qty|quantity|stock|on\s*hand|units)\b/i,
    image_url: /\b(image|photo|picture|img)\s*(url|link)?\b/i,
    category: /\b(categor(y|ies)|collection|group|type|department|section)\b/i,
    client: /\b(client|customer|account|company|buyer)\b/i,
    date: /\b(date|ordered|placed|when)\b/i,
    reference: /\b(ref(erence)?|order\s*(no|number|ref)?|our\s*ref|invoice\s*(no|number)?)\b/i,
    unit_price: /\b(unit\s*price|price\s*each|each|net\s*price|line\s*price)\b/i,
  };

  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  for (const field of fields) {
    const pattern = patterns[field];
    if (!pattern) continue;
    const index = header.findIndex(
      (h, i) => !taken.has(i) && isHeaderish(h) && pattern.test(h.trim()),
    );
    if (index >= 0) {
      taken.add(index);
      mapping[field] = XLSX.utils.encode_col(index);
    }
  }
  return mapping;
}

export interface TierLite { id: string; name: string }

/**
 * Other things a tier is called on a price list. Keyed by the tier's own name,
 * so a tier added later still matches on that name without touching this.
 */
const TIER_ALIASES: Record<string, string[]> = {
  distributor: ['distributor', 'dist', 'wholesale'],
  shop:        ['shop', 'dealer', 'retailer', 'ibd'],
  club:        ['club', 'team'],
  retail:      ['retail', 'rrp', 'srp', 'msrp'],
};

/**
 * What a column of buying prices tends to be called.
 *
 * Deliberately narrow. "Net" and "Trade" are left out although both often mean
 * cost, because on our own price list they just as often mean a tier's selling
 * price — and a sell price mistaken for a cost makes every margin wrong in the
 * flattering direction, which is the one error nobody notices.
 */
const COST_ALIASES = [
  'cost', 'our cost', 'cost price', 'buy', 'buy price', 'buying price',
  'purchase', 'purchase price', 'supplier price', 'landed', 'landed cost',
  'ex works', 'exw', 'we pay',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest alias appearing as whole words in the cell, or 0 for no match. */
function matchLength(cell: string, aliases: string[]): number {
  const text = cell.trim();
  let best = 0;
  for (const alias of aliases) {
    const re = new RegExp(`(^|[^a-z0-9])${escape(alias)}([^a-z0-9]|$)`, 'i');
    if (re.test(text)) best = Math.max(best, alias.length);
  }
  return best;
}

const MONEYISH = /\b(price|cost|rrp|srp|msrp|net|trade|amount|gbp)\b|£/i;

/** Words a tab name carries that say nothing about which tier it holds. */
const TAB_FILLER = new Set([
  'price', 'prices', 'pricing', 'list', 'sheet', 'tab', 'tier', 'trade',
  'gbp', 'vat', 'ex', 'inc', 'net', 'new', 'current',
]);

/**
 * Whether a tab is named for a tier and nothing else.
 *
 * Deliberately stricter than "contains the tier's name". A supplier's own file
 * is often tabbed "JMM Distributor Price List", and the price on it is what we
 * pay, not what a distributor pays us. Reading that as the Distributor tier
 * would sell to distributors at cost — so anything left over after the filler
 * words means we do not know, and the screen asks.
 */
function tabIsTier(sheetName: string, tierName: string): boolean {
  const words = (text: string) => text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !TAB_FILLER.has(w) && !/^\d+$/.test(w));
  return words(sheetName).join(' ') === words(tierName).join(' ')
    && words(tierName).length > 0;
}

/**
 * Works out which column prices which tier, and which one is our own cost.
 *
 * A single sheet can now carry the whole picture — one column per tier beside
 * the price we pay — so the tiers are matched by name against the header. Where
 * two candidates want the same column the more specific name takes it, which is
 * what stops "Retailer" being read as the Retail tier when a Shop tier is also
 * called that.
 *
 * `base` is the mapping already worked out for SKU, name and so on: its columns
 * are off limits, so a column headed "Product code" is never also a price.
 */
export function guessCatalogueColumns(
  header: string[], sheetName: string, tiers: TierLite[], base: ColumnMapping,
): ColumnMapping {
  const targets = [
    { key: 'cost', aliases: COST_ALIASES },
    ...tiers.map((t) => {
      const name = t.name.trim().toLowerCase();
      return { key: tierKey(t.id), aliases: [...new Set([name, ...(TIER_ALIASES[name] ?? [])])] };
    }),
  ];

  const spokenFor = new Set(
    Object.values(base).filter(Boolean).map((letter) => colIndex(letter!)),
  );

  const pairs: { col: number; key: string; score: number }[] = [];
  header.forEach((cell, col) => {
    if (spokenFor.has(col) || !isHeaderish(cell)) return;
    for (const target of targets) {
      const score = matchLength(cell, target.aliases);
      if (score) pairs.push({ col, key: target.key, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.col - b.col);

  const mapping: ColumnMapping = {};
  const usedCols = new Set<number>();
  const usedKeys = new Set<string>();
  for (const pair of pairs) {
    if (usedCols.has(pair.col) || usedKeys.has(pair.key)) continue;
    usedCols.add(pair.col);
    usedKeys.add(pair.key);
    mapping[pair.key] = XLSX.utils.encode_col(pair.col);
  }

  // The older shape: a workbook with a tab per tier, each holding one unlabelled
  // price column. Nothing matched by name, but the tab itself says which tier
  // it is, so a lone money column can be attributed.
  const namedATier = Object.keys(mapping).some((k) => k.startsWith('price:'));
  if (!namedATier) {
    const tier = tiers.find((t) => tabIsTier(sheetName, t.name));
    const spare = header
      .map((cell, col) => ({ cell, col }))
      .filter(({ cell, col }) =>
        !spokenFor.has(col) && !usedCols.has(col) && isHeaderish(cell) && MONEYISH.test(cell));
    if (tier && spare.length === 1) {
      mapping[tierKey(tier.id)] = XLSX.utils.encode_col(spare[0].col);
    }
  }

  return mapping;
}

/**
 * Columns that look like money but have not been claimed by anything.
 *
 * A supplier's own list has one price column headed just "Price", and nothing
 * on the sheet says whether that is what we pay or what someone pays us.
 * Guessing either way would be wrong half the time, so the screen names the
 * column and asks instead.
 */
export function unclaimedMoneyColumns(
  header: string[], mapping: ColumnMapping,
): { letter: string; label: string }[] {
  const claimed = new Set(
    Object.values(mapping).filter(Boolean).map((letter) => colIndex(letter!)),
  );
  return header
    .map((label, col) => ({ label: label.trim(), col }))
    .filter(({ label, col }) => !claimed.has(col) && isHeaderish(label) && MONEYISH.test(label))
    .map(({ label, col }) => ({ letter: XLSX.utils.encode_col(col), label }));
}

/** Fields that hold money: the single price, a tier's price, and our cost. */
const MONEY_FIELD = /^(price|cost|unit_price)/;

/**
 * A supplier price list is a printed document, not a data file: a title, a
 * section heading every so often, and the column headers repeated underneath
 * each one. None of those are products, and none should be reported as bad
 * rows either — there are dozens of them in a real sheet, and an import that
 * lists them as errors buries the errors that matter.
 *
 * Both shapes are recognised without guessing at content: a heading fills one
 * cell of a row and nothing else, and a repeated header row says again what
 * the header row above already said.
 */
export function isStructuralRow(
  values: Record<string, string>,
  headerLabels: string[],
): boolean {
  const filled = Object.values(values).filter((v) => v !== '');
  if (filled.length === 0) return true;

  // "BOTTOM BRACKETS" sitting alone on its row. One populated cell and no
  // money against it is a heading, never a priced product.
  const priced = Object.entries(values)
    .some(([field, v]) => v !== '' && MONEY_FIELD.test(field));
  if (filled.length === 1 && !priced) return true;

  // "CODE | DESCRIPTION | PRICE" appearing again under a heading.
  const labels = new Set(headerLabels.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const looksLikeHeader = filled.length > 1
    && filled.every((v) => labels.has(v.trim().toLowerCase()));
  return looksLikeHeader;
}

/**
 * Pulls mapped values out of the grid, skipping the header, blank rows, and
 * the section headings and repeated headers a supplier's own sheet is full of.
 * Tolerates a header row that is not the first row of the sheet.
 */
export function extractRows(
  grid: string[][],
  headerRow: number,
  mapping: ColumnMapping,
): Record<string, string>[] {
  // headerRow is 1-based, as the screen shows it, so the header cells are the
  // row before it and the body starts at that same index.
  const headerLabels = grid[headerRow - 1] ?? [];
  const body = grid.slice(headerRow);
  const fields = Object.entries(mapping).filter(([, letter]) => letter) as [string, string][];

  const rows: Record<string, string>[] = [];
  for (const row of body) {
    const values: Record<string, string> = {};
    for (const [field, letter] of fields) {
      values[field] = (row[colIndex(letter)] ?? '').toString().trim();
    }
    if (!isStructuralRow(values, headerLabels)) rows.push(values);
  }
  return rows;
}

/**
 * Parses "£1,234.50" and friends into a number. Anything that is not a number —
 * "n/a", "POA", an empty cell — comes back NaN rather than 0, so an unreadable
 * price is reported as a bad row instead of silently pricing an item at zero.
 */
export function toNumber(value: string): number {
  const cleaned = (value ?? '').replace(/[^0-9.\-]/g, '');
  if (!/\d/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
