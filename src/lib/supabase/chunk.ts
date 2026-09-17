import 'server-only';

/**
 * Asking about a lot of products without tripping the row cap.
 *
 * PostgREST returns at most `db-max-rows` rows — a thousand on a default
 * Supabase project — and says nothing when it truncates. A query that reads
 * fine for a year quietly starts returning a prefix of the answer the day the
 * catalogue outgrows the cap, which is the worst failure mode available: no
 * error, no warning, just prices that are missing from the screen and present
 * in the database.
 *
 * So anything that asks about a list of products asks in batches small enough
 * that no batch can reach the cap, whatever the catalogue grows to. The size
 * is per batch of products, and the caller says how many rows each product can
 * bring back — four tiers, two locations — so the arithmetic is stated rather
 * than assumed.
 */

/** Conservative: the default cap is 1000, and a project may have set it lower. */
const SAFE_ROWS = 800;

/** How many rows to ask for at a time when paging a whole table. */
const PAGE = 500;

export function chunkSize(rowsPerId: number): number {
  return Math.max(1, Math.floor(SAFE_ROWS / Math.max(1, rowsPerId)));
}

/**
 * Runs `fetch` over the ids in batches and concatenates the rows.
 *
 * Batches go out together rather than one after another: they are independent
 * reads, and a catalogue screen should not take fifteen round trips in series.
 */
export async function inChunks<T>(
  ids: string[],
  rowsPerId: number,
  fetch: (batch: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (!ids.length) return [];
  const size = chunkSize(rowsPerId);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  const results = await Promise.all(batches.map((batch) => fetch(batch)));
  return results.flatMap((r) => r.data ?? []);
}

/**
 * Reads a whole query, a page at a time, however many rows it turns out to be.
 *
 * For the reads that have no list of ids to batch by — the catalogue a client
 * browses, the SKUs an import compares against. `.limit(10000)` on such a
 * query looks like it says "all of them" and does not: the server caps the
 * response well below that and returns a prefix without complaint. An import
 * that sees a prefix of the catalogue treats everything past the cut as a new
 * SKU, so this one matters for more than what is drawn on a screen.
 *
 * Sequential, because each page depends on how full the last one was. `cap`
 * stops a runaway loop on a table nobody expected to be this big.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  cap = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error || !data?.length) break;
    rows.push(...data);
    // A short page is the last page. A full one might not be, so ask again.
    if (data.length < PAGE) break;
  }
  return rows;
}
