/**
 * Splitting a basket into the orders it will actually become.
 *
 * An order is raised in one currency and its invoice asks for that currency,
 * so a basket holding both euro and sterling goods is two orders and two
 * invoices. Refusing such a basket would make the customer do this split
 * themselves at the moment they had decided to buy; doing it here costs them
 * nothing and reads, on the confirmation, as two orders rather than a refusal.
 *
 * Kept apart from the server actions that call it so both the portal and the
 * counter split a basket the same way, and so the rule can be tested without
 * a database.
 */

/** Sterling first where there is a choice; the rest alphabetically. */
export function orderCurrencies(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) =>
    a === 'GBP' ? -1 : b === 'GBP' ? 1 : a.localeCompare(b));
}

/**
 * Groups lines by the currency of the product on them.
 *
 * `currencyOf` reads the catalogue, never the basket: how many orders get
 * raised must not be something a browser can decide. A product the lookup
 * does not know falls to sterling rather than being dropped — losing a line
 * silently is worse than putting it in the commonest currency, where the
 * price on the confirmation will show it up.
 */
export function splitByCurrency<T extends { product_id: string }>(
  lines: T[], currencyOf: (productId: string) => string | undefined,
): { currency: string; lines: T[] }[] {
  const by = new Map<string, T[]>();
  for (const line of lines) {
    const code = currencyOf(line.product_id) ?? 'GBP';
    by.set(code, [...(by.get(code) ?? []), line]);
  }
  return orderCurrencies(by.keys()).map((currency) => ({ currency, lines: by.get(currency)! }));
}

/** Net and VAT per currency, for a screen that has to total a basket before placing. */
export function totalsByCurrency<T>(
  lines: T[],
  currencyOf: (line: T) => string,
  netOf: (line: T) => number,
  vatRate: number,
): { currency: string; net: number; vat: number }[] {
  const by = new Map<string, number>();
  for (const line of lines) {
    const code = currencyOf(line);
    by.set(code, (by.get(code) ?? 0) + netOf(line));
  }
  return orderCurrencies(by.keys()).map((currency) => {
    const net = by.get(currency)!;
    return { currency, net, vat: (net * vatRate) / 100 };
  });
}
