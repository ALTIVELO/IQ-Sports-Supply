/**
 * The two sums the returns screen has to agree with the database about.
 *
 * `returnable_qty()` and `request_return()` are the authority: they run inside
 * the transaction that writes the row, so they are what actually stops a
 * client sending back three of the two they bought. These are the same
 * arithmetic done on the page, so the form can show a number and cap an input
 * instead of making a round trip per line.
 *
 * They live here, away from the screen, so a test can hold them against the
 * SQL. A copy of a rule that drifts from the rule is worse than no copy: the
 * screen would offer back stock the database then refuses, and the customer
 * would be told no by a form that had just said yes.
 */

export interface ClaimedQty { order_line_id: string; qty: number }

/**
 * How much of each order line is still available to send back.
 *
 * Counts every return that is not declined or cancelled, matching
 * returnable_qty(): a request nobody has read yet still holds its quantity,
 * or a client clicking twice could ask for the same item back twice and both
 * would look valid until somebody added them up.
 */
export function claimedByLine(claimed: ClaimedQty[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const c of claimed) {
    used.set(c.order_line_id, (used.get(c.order_line_id) ?? 0) + c.qty);
  }
  return used;
}

export function leftToReturn(
  lines: { id: string; qty: number }[], claimed: ClaimedQty[],
): Map<string, number> {
  const used = claimedByLine(claimed);
  return new Map(lines.map((l) => [l.id, Math.max(0, l.qty - (used.get(l.id) ?? 0))]));
}

/**
 * Whether the returns window has closed on an order.
 *
 * Measured from the last dispatch on the order, not the order date, the same
 * as request_return(): stock that sat on back order for five weeks has not
 * spent its window in our warehouse. A day is a day — an order dispatched
 * exactly `days` ago is still inside it, because "within 30 days" read by a
 * customer means the thirtieth day counts.
 */
export function windowClosed(
  lastDispatch: string | null, days: number, now: Date = new Date(),
): boolean {
  if (!lastDispatch) return false;
  const shipped = Date.parse(lastDispatch);
  if (Number.isNaN(shipped)) return false;
  return Math.floor((now.getTime() - shipped) / 86_400_000) > days;
}

/** The most recent dispatch on an order, or null if nothing has gone yet. */
export function lastDispatch(
  invoices: { shipped: boolean; shipped_at: string | null; superseded: boolean }[],
): string | null {
  const dates = invoices
    .filter((i) => !i.superseded && i.shipped && i.shipped_at)
    .map((i) => String(i.shipped_at))
    .sort();
  return dates.at(-1) ?? null;
}
