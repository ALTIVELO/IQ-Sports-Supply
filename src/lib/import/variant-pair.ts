/**
 * Whether a row's model and size columns amount to a frame size.
 *
 * Grouping needs both halves: a model says which bike, a size says which frame
 * of it. One without the other cannot be grouped, so the product imports as a
 * thing in its own right — which is what it was before either column existed.
 *
 * Emphatically not a reason to reject the row. A supplier's own price list is
 * full of Size columns that have nothing to do with frame sizes — rotor
 * diameters, cassette ratios, bar widths — and throwing those rows away would
 * silently drop every price on the sheet, which is how a whole tier ends up
 * with no prices at all.
 */
export interface VariantPair {
  group?: string;
  label?: string;
  /** True when the row gave one half and not the other. */
  halfPaired: boolean;
}

export function variantPair(
  rawGroup: string | undefined, rawLabel: string | undefined,
): VariantPair {
  const group = rawGroup?.trim() || undefined;
  const label = rawLabel?.trim() || undefined;
  if (group && label) return { group, label, halfPaired: false };
  return { halfPaired: Boolean(group) !== Boolean(label) };
}
