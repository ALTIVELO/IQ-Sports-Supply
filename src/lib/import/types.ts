/** Shared shapes for the Excel/CSV import pipeline. */

export type ImportScope = 'prices' | 'clients' | 'stock' | 'orders';

/**
 * One product as a price list gives it: what it is, what we pay for it, and
 * what each tier of customer pays us.
 *
 * A supplier's list usually has one price column and it is our cost. Ours has
 * a column per tier beside it. Both are the same row shape — `prices` simply
 * has no entries in the first case, and `cost` is NaN in the second.
 */
export interface CatalogueRow {
  sku: string; name: string; brand: string;
  image_url?: string;
  /** A category slug or name given by the sheet, overriding the classifier. */
  category?: string;
  /**
   * What this costs us. Absent where the sheet has no cost for this row; NaN
   * where it has something there that is not a number, which is an error and
   * is reported as one.
   */
  cost?: number;
  /**
   * Tier id → the price that tier pays, for the tiers this row actually
   * prices. A blank cell is left out rather than entered as NaN, so an empty
   * column is silence and a cell reading "POA" is a problem.
   */
  prices: Record<string, number>;
}

export interface ClientRow {
  name: string; email: string; tier: string; vat_no: string; address: string; phone: string;
}
export interface StockRow { sku: string; location: string; qty: number }

/** One line of a past order, as an old spreadsheet tends to hold it. */
export interface HistoricOrderRow {
  client: string; date: string; reference?: string;
  sku: string; name?: string; qty: number; unit_price: number;
}

export interface PriceChange {
  sku: string; name: string; oldPrice: number; newPrice: number;
  deltaPct: number;
  /** Anything moving more than ±25% is flagged as a likely typo. */
  suspicious: boolean;
}

/** What one tier's prices would become. */
export interface PricePreview {
  tierId: string;
  tierName: string;
  /** SKUs new to the system that this tier prices. */
  created: number;
  changed: PriceChange[];
  unchanged: number;
}

/** What our own buying prices would become. */
export interface CostPreview {
  created: number;
  changed: PriceChange[];
  unchanged: number;
  /** Priced to a customer below what we pay — the one error worth stopping for. */
  belowCost: { sku: string; name: string; tierName: string; price: number; cost: number }[];
}

export interface CataloguePreview {
  tiers: PricePreview[];
  /** Null when the file carries no cost column at all. */
  costs: CostPreview | null;
  newSkus: { sku: string; name: string }[];
  /** In the system but absent from the file — reported only, never deleted. */
  missing: { sku: string; name: string }[];
  invalid: { row: number; reason: string }[];
}

/**
 * Which column holds what.
 *
 * Tier prices are keyed `price:<tier id>`, so one sheet can price every tier
 * at once. The index signature is what makes that expressible; the named
 * fields are the ones every scope shares.
 */
export interface ColumnMapping {
  sku?: string; name?: string; brand?: string; image_url?: string;
  category?: string;
  /** What we pay our supplier. */
  cost?: string;
  email?: string; tier?: string; vat_no?: string; address?: string; phone?: string;
  location?: string; qty?: string;
  client?: string; date?: string; reference?: string; unit_price?: string;
  [field: string]: string | undefined;
}

/** The `price:<tier id>` key a tier's column is stored under. */
export const tierKey = (tierId: string) => `price:${tierId}`;

/** A sheet the user has chosen to import, with how to read it. */
export interface SheetPlan {
  sheetName: string;
  headerRow: number;
  mapping: ColumnMapping;
}

export const SUSPICIOUS_DELTA = 25;
