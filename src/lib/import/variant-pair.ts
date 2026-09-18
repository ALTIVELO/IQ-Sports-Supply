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

/**
 * Whether the column chosen as the Size is holding sizes at all.
 *
 * The failure this catches: a layout pinned to column letters, applied to a
 * sheet with a column inserted, so the Size field lands on Series. Every
 * Dura-Ace part then claims to be size "Dura-Ace", and what comes out is
 * eighty-one rows refused as duplicates of each other and an error about
 * duplicate sizes that points nowhere near the cause.
 *
 * The signature is unmistakable: a model with several members, all of them
 * one size. A size is what tells the members of a model apart, so a model
 * whose members are all one size has no sizes in it. One such group is
 * possible — the same part listed twice — so it takes a majority of the
 * grouped models before this says anything.
 */
export function sizesLookWrong(
  rows: { variant_group?: string; variant_label?: string }[],
): { value: string; models: number; rows: number } | null {
  const byGroup = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.variant_group || !r.variant_label) continue;
    byGroup.set(r.variant_group, [...(byGroup.get(r.variant_group) ?? []), r.variant_label]);
  }

  const ranges = [...byGroup.values()].filter((labels) => labels.length > 1);
  if (ranges.length < 2) return null;

  const flat = ranges.filter((labels) =>
    new Set(labels.map((l) => l.trim().toLowerCase())).size === 1);
  if (flat.length * 2 <= ranges.length) return null;

  // The commonest of the repeated values, so the message can quote the thing
  // the column actually holds rather than describe it.
  const counts = new Map<string, number>();
  for (const labels of flat) {
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [value] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    value,
    models: flat.length,
    rows: flat.reduce((a, labels) => a + labels.length, 0),
  };
}
