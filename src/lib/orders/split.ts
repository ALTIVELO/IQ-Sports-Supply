/**
 * Splitting a basket into the orders it will actually become.
 *
 * Two things force a split, and both are about what one invoice can say.
 *
 * Currency: an order is raised in one currency and its invoice asks for that
 * currency, so a basket holding both euro and sterling goods is two orders.
 *
 * Who is selling: on an agency brand's goods we are the introducer, not the
 * seller — that brand invoices the customer and carries the warranty. One
 * document cannot be a demand from a seller for half its lines and a note
 * from an agent for the other half, so those lines become their own order.
 *
 * Refusing such a basket would make the customer do this themselves at the
 * moment they had decided to buy; doing it here costs them nothing and reads,
 * on the confirmation, as two orders rather than a refusal.
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

/** What a product says about which order it belongs on. */
export interface OrderKey {
  currency?: string | null;
  /** The brand we introduce it for, where we are not the seller. */
  agentBrand?: string | null;
}

export interface OrderPart<T> {
  currency: string;
  agentBrand: string | null;
  lines: T[];
}

/**
 * Groups lines into the orders they will become.
 *
 * `keyOf` reads the catalogue, never the basket: how many orders get raised
 * must not be something a browser can decide. A product the lookup does not
 * know falls to sterling and to our own stock rather than being dropped —
 * losing a line silently is worse than putting it in the commonest case,
 * where the price on the confirmation will show it up.
 *
 * Sterling first, then our own goods before an introduced brand's, so the
 * order numbers come back in the sequence the counter thinks in.
 */
export function splitOrders<T extends { product_id: string }>(
  lines: T[], keyOf: (productId: string) => OrderKey | undefined,
): OrderPart<T>[] {
  const by = new Map<string, T[]>();
  const keys = new Map<string, { currency: string; agentBrand: string | null }>();

  for (const line of lines) {
    const k = keyOf(line.product_id);
    const currency = k?.currency || 'GBP';
    const agentBrand = k?.agentBrand ?? null;
    // Tab-joined: a brand key is a normalised name and cannot contain one.
    const id = `${currency}\t${agentBrand ?? ''}`;
    keys.set(id, { currency, agentBrand });
    by.set(id, [...(by.get(id) ?? []), line]);
  }

  return [...by.keys()]
    .sort((a, b) => {
      const ka = keys.get(a)!, kb = keys.get(b)!;
      const byCurrency = orderCurrencies([ka.currency, kb.currency]);
      if (ka.currency !== kb.currency) return byCurrency[0] === ka.currency ? -1 : 1;
      if (ka.agentBrand === kb.agentBrand) return 0;
      if (ka.agentBrand === null) return -1;
      if (kb.agentBrand === null) return 1;
      return ka.agentBrand.localeCompare(kb.agentBrand);
    })
    .map((id) => ({ ...keys.get(id)!, lines: by.get(id)! }));
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
