'use client';

import * as XLSX from 'xlsx';
import type { ColumnMapping } from './types';

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

/**
 * Guesses which column is which from the header row, so the first-time setup is
 * usually just a confirmation. Header text is matched loosely.
 */
export function guessMapping(header: string[], fields: (keyof ColumnMapping)[]): ColumnMapping {
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
  };

  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  // A column header is a label, not a sentence. Ignoring longer cells stops a
  // title block ("IQ Sports Supply — Q4 price list") being read as a header.
  const isHeaderish = (cell: string) => {
    const text = cell.trim();
    return text.length > 0 && text.length <= 40 && text.split(/\s+/).length <= 4;
  };

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
  // price is a heading, never a priced product.
  if (filled.length === 1 && !values.price) return true;

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
