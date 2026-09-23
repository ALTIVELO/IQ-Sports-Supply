/**
 * Who we are, legally, on a document somebody might have to act on.
 *
 * A limited company has to state its registered name, the fact of
 * incorporation, where, its number and its registered office on its business
 * letters, order forms and websites — the Companies (Trading Disclosures)
 * Regulations. An invoice is the document most likely to be kept, chased,
 * disputed or handed to an accountant, so it is the one that matters most.
 *
 * In one file because the same sentence has to appear in three places that
 * are otherwise unrelated — a rendered PDF, a plain-text email and, one day,
 * whatever else bills a customer — and three copies of a company number is
 * two copies that will not be corrected together.
 */

/** The registered name. Not the trading name, where they ever differ. */
export const LEGAL_NAME = 'IQ Sports Supply Ltd';

export const COMPANY_NUMBER = '17430665';

/** Where it is registered, which is not always where the post goes. */
export const REGISTERED_IN = 'England & Wales';

export const REGISTERED_OFFICE =
  '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ';

/**
 * The VAT registration, once there is one.
 *
 * Null rather than an empty string, and left out of the line entirely rather
 * than printed blank: "VAT No." with nothing after it on an invoice invites
 * somebody to reclaim VAT that was never charged.
 */
export const VAT_NUMBER: string | null = null;

/**
 * The one line, assembled.
 *
 * Built rather than written out so that adding the VAT number later is one
 * edit above and nothing else — the separator, the order and the spacing are
 * already decided here, and every document picks the change up together.
 */
export function legalFooter(): string {
  return [
    LEGAL_NAME,
    `Registered in ${REGISTERED_IN}, Company No. ${COMPANY_NUMBER}`,
    `Registered office: ${REGISTERED_OFFICE}`,
    VAT_NUMBER ? `VAT No. ${VAT_NUMBER}` : null,
  ].filter(Boolean).join(' · ');
}
