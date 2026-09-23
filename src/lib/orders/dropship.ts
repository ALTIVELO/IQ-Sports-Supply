/**
 * Sending an order straight to the client's own customer.
 *
 * A shop sells a groupset on a Tuesday and would rather we posted it to the
 * buyer than to the shop. It saves a leg of carriage and a day, and it moves
 * one thing from us to them: we no longer know the address. They took it over
 * the counter or off their own website, and nobody here can check it or know
 * whether anybody will be in to take the parcel.
 *
 * So two things have to be true before such an order can be raised, and this
 * is the rule that says so. place_order enforces the same two and is the
 * authority; this exists so a button is not offered for an order the database
 * is about to refuse.
 */

export interface DropshipState {
  on: boolean;
  /** Their customer's name and address, as one block, exactly as typed. */
  shipTo: string;
  accepted: boolean;
}

export const emptyDropship: DropshipState = { on: false, shipTo: '', accepted: false };

/**
 * Whether this order can be placed.
 *
 * Trimmed, because the database trims and refuses a blank: a screen that
 * accepts a field of spaces offers a button that then fails, which is worse
 * than a button that was never offered.
 */
export const dropshipReady = (d: DropshipState): boolean =>
  !d.on || (d.shipTo.trim().length > 0 && d.accepted);

/** What to send with the order, or nothing where it is going to the client. */
export const dropshipPayload = (d: DropshipState) =>
  (d.on ? { shipTo: d.shipTo.trim(), accepted: d.accepted } : null);
