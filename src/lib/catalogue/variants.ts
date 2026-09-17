import type { CatalogueItem } from '@/lib/types';

/**
 * A bike and the frames it comes in.
 *
 * Every size is a real product with its own SKU, price, cost and stock — that
 * is what gets ordered, allocated and shipped. This only gathers them back up
 * so the catalogue can show one bike with a size to pick, instead of five
 * lines that read as five bikes.
 *
 * A product sold as one thing is a group of one. Keeping the shapes the same
 * means the listing has one thing to render rather than two.
 */
export interface VariantGroup {
  /** Stable across renders: the variant group, or the product's own id. */
  key: string;
  /** The row the tile is drawn from — image, name, brand, collection. */
  lead: CatalogueItem;
  /** Every size, in the order a customer reads them. One entry when there are no sizes. */
  sizes: CatalogueItem[];
  /** Cheapest and dearest size, so a listing can say "from". */
  low: number;
  high: number;
  /** True when any size is on the shelf. */
  inStock: boolean;
}

// Frame sizes are ordered small to large, not alphabetically: L before XL, and
// XS before S. A numeric size (440, 500) sorts as a number after the letters.
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

/** Whether the scale above already knows where this size goes. */
export function knownSize(label: string | null | undefined): boolean {
  return LETTERS.includes((label ?? '').trim().toUpperCase());
}

export function sizeRank(label: string | null): [number, number, string] {
  const text = (label ?? '').trim().toUpperCase();
  const letter = LETTERS.indexOf(text);
  if (letter >= 0) return [0, letter, text];
  const n = Number(text.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(n) && text) return [1, n, text];
  return [2, 0, text];
}

/** The least a row needs for this file to treat it as a size of something. */
export interface Sized {
  id: string;
  variant_group: string | null;
  variant_label: string | null;
  variant_sort: number | null;
}

/** Where a size sits in its range: the import's own order first, then the scale. */
function order(a: Sized, b: Sized): number {
  if (a.variant_sort != null && b.variant_sort != null && a.variant_sort !== b.variant_sort) {
    return a.variant_sort - b.variant_sort;
  }
  const [ax, ay, at] = sizeRank(a.variant_label);
  const [bx, by, bt] = sizeRank(b.variant_label);
  return ax - bx || ay - by || at.localeCompare(bt);
}

/**
 * Folds any list of rows carrying a variant group into one entry per bike.
 *
 * Generic because the staff order desk holds a different shape from the
 * portal's catalogue — prices per tier and stock per site rather than one of
 * each — and both need the sizes gathered the same way. Anything that depends
 * on what a row actually is belongs to the caller.
 */
export function groupSizes<T extends Sized>(items: T[]): { key: string; lead: T; sizes: T[] }[] {
  const groups: { key: string; lead: T; sizes: T[] }[] = [];
  const index = new Map<string, { key: string; lead: T; sizes: T[] }>();

  for (const item of items) {
    const key = item.variant_group ?? item.id;
    const existing = index.get(key);
    if (existing) { existing.sizes.push(item); continue; }
    const group = { key, lead: item, sizes: [item] };
    index.set(key, group);
    groups.push(group);
  }

  for (const g of groups) {
    g.sizes.sort(order);
    g.lead = g.sizes[0];
  }
  return groups;
}

/**
 * Folds a flat product list into one entry per bike.
 *
 * Groups appear where their first size appeared, so a listing sorted by SKU
 * stays in the order the caller sorted it — re-sorting here would quietly
 * override whatever the screen asked the database for.
 */
export function groupVariants(products: CatalogueItem[]): VariantGroup[] {
  return groupSizes(products).map((g) => {
    const prices = g.sizes.map((s) => Number(s.price)).filter((n) => Number.isFinite(n));
    return {
      ...g,
      // The lead carries the picture and the name. Any size will do for those,
      // but a size with a photo beats one without, and the first size named the
      // bike before its range was known.
      lead: g.sizes.find((s) => s.image_url) ?? g.sizes[0],
      low: prices.length ? Math.min(...prices) : 0,
      high: prices.length ? Math.max(...prices) : 0,
      inStock: g.sizes.some((s) => s.in_stock),
    };
  });
}

/** The name without the size on the end, for a bike whose rows are "X — M". */
export function groupName(g: VariantGroup): string {
  if (g.sizes.length < 2) return g.lead.name;
  const label = g.lead.variant_label?.trim();
  if (!label) return g.lead.name;
  // Only strip a trailing size, and only when it is set off from the name, so
  // a bike genuinely called "Large" keeps its name.
  const trimmed = g.lead.name.replace(
    new RegExp(`\\s*[-–—·|(]?\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)?\\s*$`, 'i'),
    '',
  );
  return trimmed.trim() || g.lead.name;
}
