import type { CatalogueItem } from '@/lib/types';

/** A category row as the portal reads it. */
export interface CategoryRow {
  id: string; slug: string; name: string; sort: number; parent_id: string | null;
}

export interface Node {
  slug: string;
  name: string;
  /** Products filed directly here. */
  own: number;
  /** Products here and in everything beneath. */
  total: number;
  cover: string | null;
  children: Node[];
}

// Only these two fields are read, and saying so lets a screen that needs
// nothing but the counts fetch two columns instead of nine.
type Filed = Pick<CatalogueItem, 'category_slug' | 'image_url'>;

/**
 * Builds the group → collection tree with product counts.
 *
 * Counts roll up, so a group shows everything beneath it rather than only what
 * happens to be filed at its own level — a customer opening "Clothing" expects
 * the count to mean all the clothing.
 *
 * Every collection is returned, stocked or not: the full list tells a customer
 * what IQ supplies, which is worth more than hiding the gaps. Empty ones are
 * marked rather than removed, so the page can show them as clearly not-yet-
 * stocked instead of looking broken when clicked.
 */
export function buildTree(categories: CategoryRow[], products: Filed[]): Node[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const byId = new Map(categories.map((c) => [c.id, c]));

  const direct = new Map<string, { own: number; cover: string | null }>();
  for (const p of products) {
    if (!p.category_slug) continue;
    const entry = direct.get(p.category_slug) ?? { own: 0, cover: null };
    entry.own += 1;
    if (!entry.cover && p.image_url) entry.cover = p.image_url;
    direct.set(p.category_slug, entry);
  }

  const childrenOf = new Map<string | null, CategoryRow[]>();
  for (const c of categories) {
    const parentSlug = c.parent_id ? byId.get(c.parent_id)?.slug ?? null : null;
    const list = childrenOf.get(parentSlug) ?? [];
    list.push(c);
    childrenOf.set(parentSlug, list);
  }

  const build = (row: CategoryRow): Node => {
    const kids = (childrenOf.get(row.slug) ?? [])
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .map(build);

    const own = direct.get(row.slug) ?? { own: 0, cover: null };
    return {
      slug: row.slug,
      name: row.name,
      own: own.own,
      total: own.own + kids.reduce((a, k) => a + k.total, 0),
      cover: own.cover ?? kids.find((k) => k.cover)?.cover ?? null,
      children: kids,
    };
  };

  void bySlug;
  return (childrenOf.get(null) ?? [])
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(build);
}

/** Finds a node anywhere in the tree, and the groups above it. */
export function findNode(
  tree: Node[], slug: string,
): { node: Node; trail: Node[] } | null {
  const walk = (nodes: Node[], trail: Node[]): { node: Node; trail: Node[] } | null => {
    for (const n of nodes) {
      if (n.slug === slug) return { node: n, trail };
      const found = walk(n.children, [...trail, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []);
}

/** Every slug at or beneath a node — what "all products in this group" means. */
export function slugsUnder(node: Node): string[] {
  return [node.slug, ...node.children.flatMap(slugsUnder)];
}
