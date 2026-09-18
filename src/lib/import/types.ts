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
   * The money this row's cost and prices are quoted in. Absent where the sheet
   * says nothing, which leaves an existing product's currency alone and makes
   * a new one sterling — the assumption every list made before this column
   * existed.
   */
  currency?: string;
  /**
   * The range this part belongs to — Dura-Ace, Ultegra, Di2.
   *
   * Absent for most of a catalogue, and absent is not the same as blank: a
   * sheet that says nothing leaves whatever the product already had.
   */
  series?: string;
  /** Shared by every size of one bike; absent for a product sold as one thing. */
  variant_group?: string;
  /** This row's size: S, M, 440. */
  variant_label?: string;
  /** What this price does not include — import duty, VAT. */
  price_note?: string;
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
  /** What both figures are in, so a preview never shows a euro price as £. */
  currency: string;
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
  belowCost: {
    sku: string; name: string; tierName: string;
    price: number; cost: number; currency: string;
  }[];
}

export interface CataloguePreview {
  tiers: PricePreview[];
  /** Null when the file carries no cost column at all. */
  costs: CostPreview | null;
  newSkus: { sku: string; name: string }[];
  /**
   * In the catalogue but withdrawn, and priced by this file.
   *
   * A withdrawn SKU is one that was sold once and so could not be deleted. It
   * is invisible to customers, which makes it the worst possible thing for an
   * import to land on silently: the prices go in, and the product stays gone.
   */
  withdrawn: { sku: string; name: string }[];
  /**
   * Products this file would re-denominate.
   *
   * Changing a product's currency does not convert anything: the number stays
   * and the symbol in front of it changes, so £1,200 becomes €1,200. That is
   * right when a list arrives in its supplier's own money for the first time
   * and catastrophic when the column was mapped by mistake, so it is always
   * listed and never silent.
   */
  currencyChanges: { sku: string; name: string; from: string; to: string }[];
  /**
   * What this file would restate about the SKUs we already hold.
   *
   * Counted per column rather than per row, because "42 updated" does not
   * tell anybody whether the list corrects a few names or re-files the whole
   * catalogue. Worked out by the same rule the apply then uses, so nothing is
   * changed that the preview did not say would be.
   */
  restated: { field: string; rows: number }[];
  /** A handful of them written out, so the rule can be seen working. */
  restatedExamples: { sku: string; field: string; from: string | null; to: string | null }[];
  /** In the system but absent from the file — reported only, never deleted. */
  missing: { sku: string; name: string }[];
  invalid: { row: number; reason: string }[];
  /**
   * Things worth saying that are not errors: nothing was skipped and no price
   * is at risk, but the file did something the person may not have intended.
   */
  notes: string[];
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
  /** GBP or EUR, per row. */
  currency?: string;
  /** Which bike a size belongs to, and which size it is. */
  variant_group?: string;
  variant_label?: string;
  /** What the price excludes, in the supplier's own words. */
  price_note?: string;
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
