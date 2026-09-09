/** Shared shapes for the Excel/CSV import pipeline. */

export type ImportScope = 'prices' | 'clients' | 'stock';

/** One mapped row lifted out of a sheet, already trimmed. */
export interface PriceRow { sku: string; name: string; brand: string; price: number }
export interface ClientRow {
  name: string; email: string; tier: string; vat_no: string; address: string; phone: string;
}
export interface StockRow { sku: string; location: string; qty: number }

export interface PriceChange {
  sku: string; name: string; oldPrice: number; newPrice: number;
  deltaPct: number;
  /** Anything moving more than ±25% is flagged as a likely typo. */
  suspicious: boolean;
}

export interface PricePreview {
  tierId: string;
  tierName: string;
  created: PriceRow[];
  changed: PriceChange[];
  unchanged: number;
  /** In the system but absent from the sheet — reported only, never deleted. */
  missing: { sku: string; name: string }[];
  invalid: { row: number; reason: string }[];
}

export interface ColumnMapping {
  sku?: string; name?: string; brand?: string; price?: string;
  email?: string; tier?: string; vat_no?: string; address?: string; phone?: string;
  location?: string; qty?: string;
}

/** A sheet the user has chosen to import, with how to read it. */
export interface SheetPlan {
  sheetName: string;
  tierId: string | null;
  headerRow: number;
  mapping: ColumnMapping;
}

export const SUSPICIOUS_DELTA = 25;
