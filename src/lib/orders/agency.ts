/**
 * What the customer is told on an order we introduced rather than sold.
 *
 * The wording lives on the brand and is snapshotted onto the order when it is
 * placed, so every surface — the basket, the confirmation, the portal, the
 * emailed confirmation, the PDF — reads the same field and prints the same
 * sentences. A disclosure that is worded three ways is three disclosures, and
 * a customer who compares them has found a discrepancy in the one document
 * that most needs not to have any.
 *
 * Only the substitution and the layout live here. Nothing in this file
 * decides whether an order is an agency order: the database does that, off
 * the brand on the product, when the lines land.
 */

export interface AgencyNames {
  /** The brand whose goods these are and who invoices the customer. */
  brand: string;
  /** Us, as named in Settings. */
  company: string;
}

/**
 * The stored terms as the lines to print.
 *
 * `{brand}` and `{company}` are filled in at the point of showing rather than
 * baked into the stored text, so the terms stay readable in the settings
 * screen and so renaming the company in Settings does not leave a document
 * carrying the old name.
 */
export function agencyLines(
  terms: string | null | undefined, names: AgencyNames,
): string[] {
  if (!terms) return [];
  return terms
    .split('\n')
    .map((line) => line
      .replaceAll('{brand}', names.brand)
      .replaceAll('{company}', names.company)
      .trim())
    .filter(Boolean);
}

/**
 * The heading over them.
 *
 * It says the one thing a customer skimming needs to take from the block —
 * who they are buying from — before any of the detail underneath.
 */
export function agencyHeading(names: AgencyNames): string {
  return `Sold by ${names.brand} · arranged by ${names.company}`;
}
