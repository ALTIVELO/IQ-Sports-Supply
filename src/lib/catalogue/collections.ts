/**
 * The catalogue's collections, as a screen needs to offer them.
 *
 * Categories are a two-level tree — a department like Bikes holding
 * collections like Road and Gravel — and both staff screens need the same
 * thing from it: something to pick, with a count beside it so an empty shelf
 * is visible before it is clicked.
 *
 * Counts here are of SKUs, not of things a customer is offered. Staff work on
 * SKUs: every frame size is its own row on the stock table and its own line on
 * an order, so a bike built in five sizes really is five rows to scroll past.
 * That is the opposite of the client-facing count in tree.ts, deliberately.
 */

export interface CategoryLite {
  id: string; slug: string; name: string; sort: number; parent_id: string | null;
}

export interface CollectionOption extends CategoryLite {
  /** SKUs filed directly here. */
  own: number;
  /** SKUs here and in every collection beneath. */
  total: number;
}

export interface CollectionGroup {
  department: CollectionOption;
  collections: CollectionOption[];
}

/**
 * Departments with the collections inside them, each carrying its count.
 *
 * Every category is returned, stocked or not. A department with nothing in it
 * is a real part of the range that has not been priced yet, and hiding it
 * makes a gap look like something that does not exist.
 */
export function groupCollections(
  categories: CategoryLite[], counts: Map<string, number>,
): CollectionGroup[] {
  const bySort = (a: CategoryLite, b: CategoryLite) => a.sort - b.sort || a.name.localeCompare(b.name);
  const own = (c: CategoryLite): number => counts.get(c.id) ?? 0;

  return categories
    .filter((c) => c.parent_id === null)
    .sort(bySort)
    .map((department) => {
      const collections = categories
        .filter((c) => c.parent_id === department.id)
        .sort(bySort)
        .map((c) => ({ ...c, own: own(c), total: own(c) }));
      return {
        department: {
          ...department,
          own: own(department),
          total: own(department) + collections.reduce((a, c) => a + c.total, 0),
        },
        collections,
      };
    });
}

/**
 * A category and everything beneath it.
 *
 * Picking a department has to show what is in its collections as well as what
 * is filed against the department itself — otherwise choosing Bikes shows the
 * handful of bikes nobody got round to filing, and none of the bikes.
 */
export function idsUnder(categories: CategoryLite[], id: string): string[] {
  return [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)];
}

/** The same, by slug, for a screen whose URL carries the readable name. */
export function idsUnderSlug(categories: CategoryLite[], slug: string): string[] {
  const found = categories.find((c) => c.slug === slug);
  return found ? idsUnder(categories, found.id) : [];
}

/**
 * The catalogue's own URL for a collection and a search term.
 *
 * Both filters live in the URL so a shelf survives a reload and can be sent to
 * somebody, and so the query that fetches the page is the one doing the
 * filtering. They have to compose: choosing a collection must not silently
 * drop the search, and searching must not drop the collection, which is what
 * a plain GET form would do to whichever of the two it did not carry.
 */
export function catalogueHref(
  current: { collection: string | null; q: string },
  next: { collection?: string | null; q?: string },
  base = '/staff/catalogue',
): string {
  const collection = next.collection === undefined ? current.collection : next.collection;
  const q = (next.q === undefined ? current.q : next.q).trim();
  const params = new URLSearchParams();
  if (collection) params.set('collection', collection);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The department a collection sits in, so a deep link can open the right row. */
export function departmentOf(
  categories: CategoryLite[], slug: string | null,
): CategoryLite | null {
  const found = categories.find((c) => c.slug === slug);
  if (!found) return null;
  if (!found.parent_id) return found;
  return categories.find((c) => c.id === found.parent_id) ?? null;
}
