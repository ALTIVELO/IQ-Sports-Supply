/**
 * What a quantity costs, when the advertised price is a price by the outer.
 *
 * Shimano sell by the carton — a shifter in tens, a charging cable in
 * hundreds — and the trade price on our list is the price at that quantity.
 * Below it the part costs more. This is the rule that says by how much, and
 * it is the same arithmetic as price_for_qty() in the database, written once
 * here so every screen agrees with the invoice.
 *
 * The database is the authority: place_order() prices each line itself, and
 * nothing a browser computes reaches an invoice. What this is for is showing
 * somebody the price before they commit to it, which is the whole point —
 * being told at invoice time is how it worked before.
 */

export interface OuterPriced {
  price: number;
  /** The carton quantity. One for most of a catalogue. */
  moq: number | null;
  /** What one costs below the carton, or null for one price at any quantity. */
  break_price: number | null;
}

/** Whether this product is sold in cartons with a different price outside one. */
export const hasOuter = (p: OuterPriced): boolean =>
  (p.moq ?? 1) > 1 && p.break_price !== null;

/**
 * The rate for this quantity.
 *
 * At the MOQ exactly, the advertised price: an outer of ten means ten is
 * enough, not eleven. A quantity of nothing is quoted at the price it would
 * be bought at, which for a carton product is the loose price — the honest
 * answer to "what does one cost".
 */
export function priceAtQty(p: OuterPriced, qty: number): number {
  if (!hasOuter(p)) return p.price;
  return qty >= (p.moq ?? 1) ? p.price : (p.break_price as number);
}

/** How many more would reach the carton price, or zero once it is reached. */
export const shortOfOuter = (p: OuterPriced, qty: number): number =>
  hasOuter(p) && qty > 0 && qty < (p.moq ?? 1) ? (p.moq as number) - qty : 0;

/**
 * What the difference is worth on this line.
 *
 * Shown rather than left to be worked out: "3 more for the box price" is a
 * suggestion, and "3 more saves £132" is a reason.
 */
export const outerSaving = (p: OuterPriced, qty: number): number => {
  const short = shortOfOuter(p, qty);
  if (!short) return 0;
  const loose = qty * (p.break_price as number);
  const box = (p.moq as number) * p.price;
  return loose - box;
};
