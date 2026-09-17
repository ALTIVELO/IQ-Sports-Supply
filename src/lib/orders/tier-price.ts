/**
 * What a client pays for a product, and what to do when nothing says.
 *
 * A product nobody has priced on a tier has no price on that tier. It does not
 * have a price of zero — and rendering one is the most expensive mistake this
 * screen can make, because a zero reads as free and nothing downstream
 * questions it. place_order refuses such a line anyway, so the only question
 * is whether the person on the phone finds out now or after keying forty of
 * them.
 */

/** The tier price, or undefined where the tier does not price this product. */
export function tierPrice(
  prices: Record<string, number> | undefined, tierId: string | undefined,
): number | undefined {
  if (!tierId || !prices) return undefined;
  const price = prices[tierId];
  return typeof price === 'number' && Number.isFinite(price) ? price : undefined;
}

/**
 * The price range across a set of sizes, over the priced ones only.
 *
 * `unpriced` is how many were left out. Counting an unpriced frame as zero is
 * what made a whole bike read "from £0.00" when one size had never been priced
 * on a client's tier, and dropping them silently would give a range that is
 * true of only some of what it claims to cover.
 */
export function priceRange(
  values: (number | undefined)[],
): { low?: number; high?: number; unpriced: number } {
  const priced = values.filter((n): n is number => n !== undefined);
  return {
    low: priced.length ? Math.min(...priced) : undefined,
    high: priced.length ? Math.max(...priced) : undefined,
    unpriced: values.length - priced.length,
  };
}
