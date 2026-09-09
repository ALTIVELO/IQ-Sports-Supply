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
 * Pulls mapped values out of the grid, skipping the header and any blank rows.
 * Tolerates a header row that is not the first row of the sheet.
 */
export function extractRows(
  grid: string[][],
  headerRow: number,
  mapping: ColumnMapping,
): Record<string, string>[] {
  const body = grid.slice(headerRow);
  const fields = Object.entries(mapping).filter(([, letter]) => letter) as [string, string][];

  const rows: Record<string, string>[] = [];
  for (const row of body) {
    const values: Record<string, string> = {};
    let hasContent = false;
    for (const [field, letter] of fields) {
      const value = (row[colIndex(letter)] ?? '').toString().trim();
      values[field] = value;
      if (value) hasContent = true;
    }
    if (hasContent) rows.push(values);
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
