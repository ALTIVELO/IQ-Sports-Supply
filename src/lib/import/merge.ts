/**
 * Folding a workbook into one row per SKU, and refusing the rows that cannot
 * be read.
 *
 * Lifted out of the import action so it can be tested without a database
 * behind it. This is the most consequential hundred lines in the import path:
 * everything after it deals in "this product, these prices, this cost" and
 * believes what it is handed, so a figure dropped here is a figure nobody
 * downstream can miss.
 */
import type { CatalogueRow } from './types';
import { variantPair, sizesLookWrong } from './variant-pair';

export const norm = (sku: string) => sku.trim().toLowerCase();

/**
 * Reads a currency cell.
 *
 * Returns undefined for silence — most price lists have no such column and
 * are sterling — and null for something there that we cannot read, which is
 * reported as a bad row. Guessing sterling from an unreadable cell would put
 * a euro price list into the system under the wrong symbol, and every margin
 * taken off it afterwards would be wrong by the rate.
 */
function readCurrency(raw: string | undefined): 'GBP' | 'EUR' | null | undefined {
  const text = (raw ?? '').trim().toUpperCase();
  if (!text) return undefined;
  if (['GBP', '£', 'POUND', 'POUNDS', 'STERLING', 'GBP £'].includes(text)) return 'GBP';
  if (['EUR', '€', 'EURO', 'EUROS', 'EUR €'].includes(text)) return 'EUR';
  return null;
}

/**
 * Folds every included sheet into one row per SKU.
 *
 * A workbook may hold the whole catalogue on one tab with a column per tier,
 * or a tab per tier with one price column each. Merging by SKU makes both the
 * same thing by the time anything is compared, so the rest of this file only
 * ever deals with "this product, these prices, this cost".
 */
export function mergeSheets(sheets: { rows: CatalogueRow[] }[]) {
  const merged = new Map<string, CatalogueRow>();
  const invalid: { row: number; reason: string }[] = [];
  let line = 0;
  // Rows carrying one half of a size-and-model pair. Counted rather than
  // listed: on a sheet with a stray Size column that is every row, and a
  // hundred identical complaints would bury the ones that matter.
  let halfPaired = 0;

  for (const sheet of sheets) {
    const seenHere = new Set<string>();
    for (const row of sheet.rows) {
      line += 1;
      const sku = row.sku?.trim();
      if (!sku) { invalid.push({ row: line, reason: 'No SKU' }); continue; }
      const key = norm(sku);

      // Twice on one sheet is a mistake in the sheet. Twice across sheets is
      // the tab-per-tier shape, and is the whole point of merging.
      if (seenHere.has(key)) {
        invalid.push({ row: line, reason: `${sku} appears twice on the same sheet` });
        continue;
      }
      seenHere.add(key);

      for (const price of Object.values(row.prices)) {
        if (!Number.isFinite(price) || price < 0) {
          invalid.push({ row: line, reason: `Unreadable price for ${sku}` });
        }
      }
      if (row.cost !== undefined && (!Number.isFinite(row.cost) || row.cost < 0)) {
        invalid.push({ row: line, reason: `Unreadable cost for ${sku}` });
      }
      // The same check on the figures beside them. Without it a "POA" in a
      // loose column reaches the database as NaN, and the run fails halfway
      // through with a type error instead of on this screen with a row number.
      for (const price of Object.values(row.breakPrices ?? {})) {
        if (!Number.isFinite(price) || price < 0) {
          invalid.push({ row: line, reason: `Unreadable under-outer price for ${sku}` });
        }
      }
      if (row.breakCost !== undefined
          && (!Number.isFinite(row.breakCost) || row.breakCost < 0)) {
        invalid.push({ row: line, reason: `Unreadable under-outer cost for ${sku}` });
      }
      if (row.moq !== undefined && !(Number.isFinite(row.moq) && row.moq >= 1)) {
        invalid.push({ row: line, reason: `"${row.moq}" is not an outer quantity for ${sku}` });
      }

      /*
       * A loose price under the carton price is a swapped column.
       *
       * The database refuses it outright, which is the right place for the
       * last word but the wrong place to find out: by then the products have
       * been created and the run fails on a constraint name. Caught here it
       * is a row on the preview, named, before anything is written.
       */
      for (const [tierId, loose] of Object.entries(row.breakPrices ?? {})) {
        const byTheOuter = row.prices[tierId];
        if (byTheOuter === undefined || !Number.isFinite(loose)) continue;
        if (loose < byTheOuter) {
          invalid.push({
            row: line,
            reason: `${sku}: ${loose.toFixed(2)} under the outer is less than `
                  + `${byTheOuter.toFixed(2)} by the outer — the two columns look swapped`,
          });
        }
      }

      const currency = readCurrency(row.currency);
      if (currency === null) {
        invalid.push({ row: line, reason: `${sku}: "${row.currency}" is not a currency we hold` });
      }

      const { group, label, halfPaired: unpaired } =
        variantPair(row.variant_group, row.variant_label);
      if (unpaired) halfPaired += 1;

      const usable = (v: number | undefined) =>
        v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;

      const prices = Object.fromEntries(
        Object.entries(row.prices).filter(([, v]) => Number.isFinite(v) && v >= 0),
      );
      const breakPrices = Object.fromEntries(
        Object.entries(row.breakPrices ?? {}).filter(([, v]) => Number.isFinite(v) && v >= 0),
      );
      const cost = usable(row.cost);
      const breakCost = usable(row.breakCost);
      const moq = row.moq !== undefined && Number.isFinite(row.moq) && row.moq >= 1
        ? Math.round(row.moq) : undefined;

      const existing = merged.get(key);

      // Two tabs pricing one SKU in two currencies is not a merge, it is a
      // contradiction: one of the two numbers is about to be read as the
      // other's money. Say so rather than letting the last tab win.
      if (existing?.currency && currency && existing.currency !== currency) {
        invalid.push({
          row: line,
          reason: `${sku} is priced in both ${existing.currency} and ${currency}`,
        });
        continue;
      }

      merged.set(key, existing
        ? {
            ...existing,
            name: existing.name || row.name,
            brand: existing.brand || row.brand,
            category: existing.category || row.category,
            image_url: existing.image_url || row.image_url,
            series: existing.series || row.series?.trim(),
            currency: existing.currency ?? currency ?? undefined,
            variant_group: existing.variant_group ?? group,
            variant_label: existing.variant_label ?? label,
            price_note: existing.price_note || row.price_note?.trim(),
            cost: cost ?? existing.cost,
            prices: { ...existing.prices, ...prices },
            // Carried the same way as the figures they sit beside. Left out,
            // a SKU priced on one tab and given its outer on another would
            // import at the second tab's price and no outer at all — silently,
            // because the row was there and the column was not.
            moq: moq ?? existing.moq,
            breakCost: breakCost ?? existing.breakCost,
            breakPrices: { ...existing.breakPrices, ...breakPrices },
          }
        : {
            ...row, sku, cost, prices, moq, breakCost, breakPrices,
            currency: currency ?? undefined,
            // Trimmed, not emptied to undefined: a column that is there and
            // blank is a different thing from a column that is not there, and
            // an import told to take blanks as instructions needs to tell them
            // apart.
            series: row.series?.trim(),
            variant_group: group, variant_label: label,
            price_note: row.price_note?.trim(),
          });
    }
  }

  /*
   * Before listing the clashes, ask whether the Size column is a size column.
   *
   * A model whose members are all one size has no sizes in it, and a sheet
   * where most models look like that has had something else read as the Size.
   * Saying that once beats eighty-one rows each reporting that two products
   * are the same size as each other, all of which are true and none of which
   * name the cause.
   */
  const wrongColumn = sizesLookWrong([...merged.values()]);
  if (wrongColumn) {
    invalid.push({
      row: 0,
      reason: `The Size column does not look like sizes: ${wrongColumn.rows} products `
            + `across ${wrongColumn.models} models all give the same one `
            + `("${wrongColumn.value}"). A size is what tells the members of a model `
            + 'apart, so point Size at the column that does — and check Model too, '
            + 'since a saved layout that has slipped by one usually takes both.',
    });
  }

  // The database refuses two products claiming one size of one model, and it
  // would do so halfway through writing the import. Better to say which rows
  // clash while nothing has been written.
  const takenSize = new Map<string, string>();
  for (const row of merged.values()) {
    if (!row.variant_group || !row.variant_label) continue;
    const key = `${row.variant_group.toLowerCase()}\u0000${row.variant_label.toLowerCase()}`;
    const already = takenSize.get(key);
    if (already) {
      invalid.push({
        row: 0,
        reason: `${already} and ${row.sku} are both `
              + `${row.variant_group} size ${row.variant_label}`,
      });
    } else {
      takenSize.set(key, row.sku);
    }
  }

  // Said once, and not as a skipped row: nothing was skipped, and a sheet
  // whose Size column means rotor diameters would otherwise report every row
  // it has as a problem.
  const notes: string[] = [];
  if (halfPaired) {
    notes.push(
      `${halfPaired} row${halfPaired === 1 ? '' : 's'} gave a size without a model to put `
      + 'it under (or a model with no size), so those import as ordinary products rather '
      + 'than as sizes of one thing. Prices and costs are unaffected. If this file really '
      + 'does hold frame sizes, point the Model column at whatever names the bike.');
  }

  /*
   * What the file says about cartons, said out loud.
   *
   * The tier sections below report price changes, and the restatement tally
   * reports outers, but a price for fewer than an outer appears in neither —
   * so without this the import would write a second price on to forty-eight
   * products having told nobody. A preview that does not mention what it is
   * about to write is not a preview.
   */
  const all = [...merged.values()];
  const withOuter = all.filter((r) => (r.moq ?? 1) > 1);
  const withLoose = all.filter((r) => Object.keys(r.breakPrices ?? {}).length > 0);
  if (withOuter.length || withLoose.length) {
    notes.push(
      `${withOuter.length} row${withOuter.length === 1 ? '' : 's'} set an outer — the `
      + 'least that buys the advertised price — and '
      + `${withLoose.length} carr${withLoose.length === 1 ? 'ies' : 'y'} a price for `
      + 'fewer than one. Below the outer that price applies; at or above it the '
      + 'advertised one does.');
  }

  // An outer with no price to go with it is not an error: the part simply
  // sells at the advertised price whatever the quantity, which is what
  // happened before outers existed. It is worth saying so it is not mistaken
  // for a column that failed to map.
  const outerOnly = withOuter.filter((r) => !Object.keys(r.breakPrices ?? {}).length);
  if (outerOnly.length) {
    notes.push(
      `${outerOnly.length} of those set an outer with no price for fewer than one, so `
      + 'they sell at the advertised price at any quantity. Nothing is lost; they just '
      + 'have no second price yet.');
  }

  /*
   * A loose price on a tier this file does not otherwise price.
   *
   * These are dropped on apply, because a price for fewer than an outer has
   * nothing to be "fewer than" without the advertised price beside it. Almost
   * always a column pointed at the wrong tier, and silently discarding it is
   * how a mapping mistake survives to the next quarter.
   */
  const orphaned = all.filter((r) =>
    Object.keys(r.breakPrices ?? {}).some((tierId) => r.prices[tierId] === undefined));
  if (orphaned.length) {
    notes.push(
      `${orphaned.length} row${orphaned.length === 1 ? '' : 's'} give a price for fewer `
      + 'than an outer on a tier this file does not otherwise price. Those are ignored — '
      + 'a second price needs the first beside it. Check the two columns are pointed at '
      + 'the same tier.');
  }

  return { rows: all, invalid, notes };
}
