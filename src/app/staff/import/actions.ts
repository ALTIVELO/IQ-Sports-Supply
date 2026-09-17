'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { SUSPICIOUS_DELTA, type CatalogueRow, type CataloguePreview,
         type ClientRow, type ColumnMapping, type CostPreview, type ImportScope,
         type PriceChange, type PricePreview, type StockRow,
         type HistoricOrderRow } from '@/lib/import/types';
import type { ActionResult } from '../actions';
import { classifyProduct } from '@/lib/catalogue/categories';

const norm = (sku: string) => sku.trim().toLowerCase();

// ── saved column mappings ───────────────────────────────────────────────────

export async function loadTemplates(): Promise<
  { scope: string; tier_id: string | null; header_row: number; mapping: ColumnMapping }[]
> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();
  const { data } = await sb.from('import_templates').select('scope, tier_id, header_row, mapping');
  return (data ?? []) as never;
}

/** Saved per tier, so every subsequent quarter is pure drag-and-drop. */
export async function saveTemplate(input: {
  scope: ImportScope; tierId: string | null; headerRow: number; mapping: ColumnMapping;
}): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();
  const { error } = await sb.from('import_templates').upsert(
    {
      scope: input.scope, tier_id: input.tierId,
      header_row: input.headerRow, mapping: input.mapping,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'scope,tier_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: 'Column mapping saved' };
}

// ── catalogue import: SKUs, tier prices and what they cost us ───────────────

/** Every tier this file prices, in the order the tiers themselves are kept. */
function tiersPriced(rows: CatalogueRow[], tiers: { id: string; name: string }[]) {
  const seen = new Set(rows.flatMap((r) => Object.keys(r.prices)));
  return tiers.filter((t) => seen.has(t.id));
}

/**
 * Folds every included sheet into one row per SKU.
 *
 * A workbook may hold the whole catalogue on one tab with a column per tier,
 * or a tab per tier with one price column each. Merging by SKU makes both the
 * same thing by the time anything is compared, so the rest of this file only
 * ever deals with "this product, these prices, this cost".
 */
function mergeSheets(sheets: { rows: CatalogueRow[] }[]) {
  const merged = new Map<string, CatalogueRow>();
  const invalid: { row: number; reason: string }[] = [];
  let line = 0;

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

      const prices = Object.fromEntries(
        Object.entries(row.prices).filter(([, v]) => Number.isFinite(v) && v >= 0),
      );
      const cost = row.cost !== undefined && Number.isFinite(row.cost) && row.cost >= 0
        ? row.cost : undefined;

      const existing = merged.get(key);
      merged.set(key, existing
        ? {
            ...existing,
            name: existing.name || row.name,
            brand: existing.brand || row.brand,
            category: existing.category || row.category,
            image_url: existing.image_url || row.image_url,
            cost: cost ?? existing.cost,
            prices: { ...existing.prices, ...prices },
          }
        : { ...row, sku, cost, prices });
    }
  }

  return { rows: [...merged.values()], invalid };
}

/** The price in force for each product on a tier, as at a date. */
async function pricesAsAt(
  sb: Awaited<ReturnType<typeof supabaseServer>>, tierId: string, on: string,
) {
  const { data } = await sb
    .from('tier_prices')
    .select('product_id, price, effective_from')
    .eq('tier_id', tierId)
    .lte('effective_from', on)
    .order('effective_from', { ascending: false });

  const current = new Map<string, number>();
  for (const r of data ?? []) {
    if (!current.has(r.product_id)) current.set(r.product_id, Number(r.price));
  }
  return current;
}

/** What each product cost us, as at a date. */
async function costsAsAt(
  sb: Awaited<ReturnType<typeof supabaseServer>>, on: string,
) {
  const { data } = await sb
    .from('product_costs')
    .select('product_id, cost, effective_from')
    .lte('effective_from', on)
    .order('effective_from', { ascending: false });

  const current = new Map<string, number>();
  for (const r of data ?? []) {
    if (!current.has(r.product_id)) current.set(r.product_id, Number(r.cost));
  }
  return current;
}

function describeChange(
  sku: string, name: string, old: number | undefined, next: number,
): PriceChange | null {
  if (old !== undefined && Math.abs(old - next) < 0.005) return null;
  const from = old ?? 0;
  const deltaPct = from === 0 ? 100 : ((next - from) / from) * 100;
  return {
    sku, name, oldPrice: from, newPrice: next, deltaPct,
    // Priced from nothing is not a swing, it is a first price.
    suspicious: old !== undefined && Math.abs(deltaPct) > SUSPICIOUS_DELTA,
  };
}

/**
 * Compares a file against what is already in the system. Reads only — nothing
 * is written until the user applies the preview.
 */
export async function previewCatalogue(
  sheets: { rows: CatalogueRow[] }[],
  effectiveFrom: string,
): Promise<{ ok: true; preview: CataloguePreview } | { ok: false; error: string }> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: products }] = await Promise.all([
    sb.from('tiers').select('id, name').order('sort'),
    // Withdrawn products included. They still hold the SKU, so a preview that
    // cannot see them calls a SKU new that the import will not create, and
    // says nothing about the one place the prices are actually going.
    sb.from('products').select('id, sku, name, active').limit(10000),
  ]);

  const { rows, invalid } = mergeSheets(sheets);
  if (!rows.length) return { ok: false, error: 'That file had no product rows in it' };

  const bySku = new Map((products ?? []).map((p) => [norm(p.sku), p]));
  const priced = tiersPriced(rows, tiers ?? []);

  const nameOf = (r: CatalogueRow) => bySku.get(norm(r.sku))?.name ?? r.name ?? r.sku;

  // ── per tier ──
  const tierPreviews: PricePreview[] = [];

  for (const tier of priced) {
    const current = await pricesAsAt(sb, tier.id, effectiveFrom);
    const changed: PriceChange[] = [];
    let created = 0;
    let unchanged = 0;

    for (const row of rows) {
      const price = row.prices[tier.id];
      if (price === undefined) continue;

      const product = bySku.get(norm(row.sku));
      if (!product) { created += 1; continue; }

      const change = describeChange(product.sku, product.name, current.get(product.id), price);
      if (change) changed.push(change); else unchanged += 1;
    }

    tierPreviews.push({ tierId: tier.id, tierName: tier.name, created, changed, unchanged });
  }

  // ── what we pay ──
  const withCost = rows.filter((r) => r.cost !== undefined);
  let costs: CostPreview | null = null;

  if (withCost.length) {
    const current = await costsAsAt(sb, effectiveFrom);
    const changed: PriceChange[] = [];
    let created = 0;
    let unchanged = 0;

    for (const row of withCost) {
      const product = bySku.get(norm(row.sku));
      if (!product) { created += 1; continue; }
      const change = describeChange(product.sku, product.name, current.get(product.id), row.cost!);
      if (change) changed.push(change); else unchanged += 1;
    }

    // Against the prices this same file sets, not the ones it replaces: what
    // matters is whether we would be selling at a loss once it is applied.
    const belowCost: CostPreview['belowCost'] = [];
    for (const row of withCost) {
      for (const tier of priced) {
        const price = row.prices[tier.id];
        if (price === undefined || price > row.cost!) continue;
        belowCost.push({
          sku: row.sku, name: nameOf(row), tierName: tier.name,
          price, cost: row.cost!,
        });
      }
    }

    costs = { created, changed, unchanged, belowCost };
  }

  const inFile = new Set(rows.map((r) => norm(r.sku)));
  return {
    ok: true,
    preview: {
      tiers: tierPreviews,
      costs,
      newSkus: rows.filter((r) => !bySku.has(norm(r.sku)))
        .map((r) => ({ sku: r.sku, name: r.name || r.sku })),
      withdrawn: rows
        .map((r) => bySku.get(norm(r.sku)))
        .filter((p) => p !== undefined && !p.active)
        .map((p) => ({ sku: p!.sku, name: p!.name })),
      // Withdrawn products are not "missing from the file" — they are gone on
      // purpose, and listing them here would bury the ones that matter.
      missing: (products ?? [])
        .filter((p) => p.active && !inFile.has(norm(p.sku)))
        .map((p) => ({ sku: p.sku, name: p.name })),
      invalid,
    },
  };
}

/**
 * Applies a previewed import.
 *
 * Creates products for new SKUs, then writes tier_prices and product_costs
 * rows dated to the effective date. Both are dated histories: nothing is
 * overwritten, and last quarter's margin still reads as last quarter's.
 */
export async function applyCatalogue(input: {
  sheets: { rows: CatalogueRow[] }[];
  effectiveFrom: string;
  filename: string;
  deactivateMissing: boolean;
  /**
   * Put a withdrawn SKU back in the catalogue when this file prices it.
   *
   * Without this an import lands on a withdrawn product in total silence: the
   * prices go in, the product stays invisible, and the only clue is that the
   * new SKU you expected never appears. Pricing something is as clear a
   * statement of intent to sell it as there is.
   */
  reactivateWithdrawn: boolean;
}): Promise<ActionResult> {
  const user = await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { rows } = mergeSheets(input.sheets);
  const valid = rows.filter((r) => r.sku.trim());
  if (!valid.length) return { ok: false, error: 'There was nothing to import' };

  const { data: tiers } = await sb.from('tiers').select('id, name').order('sort');
  const priced = tiersPriced(valid, tiers ?? []);

  const { data: existing } = await sb.from('products')
    .select('id, sku, active').limit(10000);
  const bySku = new Map((existing ?? []).map((p) => [norm(p.sku), p.id]));
  const withdrawn = new Map(
    (existing ?? []).filter((p) => !p.active).map((p) => [norm(p.sku), p.id]));

  // ── withdrawn SKUs this file prices ──
  const backInStock = valid
    .map((r) => withdrawn.get(norm(r.sku)))
    .filter((id): id is string => Boolean(id));

  let revived = 0;
  if (input.reactivateWithdrawn && backInStock.length) {
    const { error } = await sb.from('products')
      .update({ active: true }).in('id', backInStock);
    if (error) return { ok: false, error: `Bringing withdrawn SKUs back failed: ${error.message}` };
    revived = backInStock.length;
  }

  // ── new SKUs ──
  const toCreate = valid.filter((r) => !bySku.has(norm(r.sku)));
  let added = 0;
  if (toCreate.length) {
    // A category column in the sheet is taken at its word — a supplier's own
    // section headings know more than any classifier can read out of a line
    // like "RTCL900LJ". Where the sheet says nothing, the description is
    // classified, so nobody has to maintain a category column in Excel.
    const { data: categories } = await sb.from('categories').select('id, slug, name');
    const categoryId = new Map((categories ?? []).map((c) => [c.slug, c.id]));
    const byLabel = new Map((categories ?? []).flatMap((c) => [
      [norm(c.slug), c.id] as const,
      [norm(c.name), c.id] as const,
    ]));

    const { data: inserted, error } = await sb.from('products')
      .insert(toCreate.map((r) => {
        const given = r.category?.trim();
        const givenId = given ? byLabel.get(norm(given)) ?? null : null;
        const slug = givenId ? null : classifyProduct({ name: r.name, brand: r.brand, sku: r.sku });
        const image = r.image_url?.trim();
        return {
          sku: r.sku.trim(),
          name: r.name?.trim() || r.sku.trim(),
          brand: r.brand?.trim() || null,
          category_id: givenId ?? (slug ? categoryId.get(slug) ?? null : null),
          // Only accept a real URL; a sheet often carries a filename here,
          // which would render as a broken image.
          image_url: image && /^https?:\/\//i.test(image) ? image : null,
        };
      }))
      .select('id, sku');
    if (error) return { ok: false, error: `Creating new SKUs failed: ${error.message}` };
    for (const p of inserted ?? []) bySku.set(norm(p.sku), p.id);
    added = inserted?.length ?? 0;
  }

  // ── sell prices ──
  let priceRows = 0;
  for (const tier of priced) {
    const batch = valid
      .filter((r) => r.prices[tier.id] !== undefined && bySku.has(norm(r.sku)))
      .map((r) => ({
        product_id: bySku.get(norm(r.sku))!,
        tier_id: tier.id,
        price: r.prices[tier.id],
        effective_from: input.effectiveFrom,
      }));
    if (!batch.length) continue;

    const { error } = await sb.from('tier_prices')
      .upsert(batch, { onConflict: 'product_id,tier_id,effective_from' });
    if (error) return { ok: false, error: `Writing ${tier.name} prices failed: ${error.message}` };
    priceRows += batch.length;
  }

  // ── what we pay ──
  const costBatch = valid
    .filter((r) => r.cost !== undefined && bySku.has(norm(r.sku)))
    .map((r) => ({
      product_id: bySku.get(norm(r.sku))!,
      cost: r.cost!,
      effective_from: input.effectiveFrom,
    }));

  if (costBatch.length) {
    const { error } = await sb.from('product_costs')
      .upsert(costBatch, { onConflict: 'product_id,effective_from' });
    if (error) return { ok: false, error: `Writing cost prices failed: ${error.message}` };

    // Orders placed before we knew what their lines cost can be costed now,
    // at the cost in force on the day each was placed. Nothing already
    // recorded is touched.
    await sb.rpc('refill_order_line_costs');
  }

  if (input.deactivateMissing) {
    const present = new Set(valid.map((r) => norm(r.sku)));
    const stale = (existing ?? []).filter((p) => !present.has(norm(p.sku))).map((p) => p.id);
    if (stale.length) await sb.from('products').update({ active: false }).in('id', stale);
  }

  await sb.from('price_imports').insert({
    tier_id: priced.length === 1 ? priced[0].id : null,
    filename: input.filename,
    rows_added: added,
    rows_changed: priceRows,
    costs_changed: costBatch.length,
    effective_from: input.effectiveFrom,
    applied_by: user.id,
  });

  revalidatePath('/staff/catalogue');
  revalidatePath('/staff/orders');
  revalidatePath('/staff/import');

  const parts = [`${added} new SKU${added === 1 ? '' : 's'}`];
  if (revived) parts.push(`${revived} brought back from withdrawn`);
  else if (backInStock.length) {
    parts.push(`${backInStock.length} still withdrawn and so not on sale`);
  }
  if (priceRows) {
    parts.push(`${priceRows} price${priceRows === 1 ? '' : 's'} across `
      + `${priced.length} tier${priced.length === 1 ? '' : 's'}`);
  }
  if (costBatch.length) parts.push(`${costBatch.length} cost${costBatch.length === 1 ? '' : 's'}`);

  return { ok: true, message: `Applied — ${parts.join(', ')}, effective ${input.effectiveFrom}` };
}

// ── client and stock imports ────────────────────────────────────────────────

export async function applyClients(rows: ClientRow[]): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: existing }] = await Promise.all([
    sb.from('tiers').select('id, name'),
    sb.from('clients').select('id, name'),
  ]);

  const tierByName = new Map((tiers ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  const byName = new Map((existing ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  let added = 0;
  let updated = 0;

  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    const tierId = tierByName.get((row.tier ?? '').trim().toLowerCase());
    if (!tierId) continue;

    const fields = {
      name, tier_id: tierId,
      email: row.email?.trim() || null,
      phone: row.phone?.trim() || null,
      vat_no: row.vat_no?.trim() || null,
      address: row.address?.trim() || null,
    };

    const id = byName.get(name.toLowerCase());
    if (id) {
      await sb.from('clients').update(fields).eq('id', id);
      updated += 1;
    } else {
      await sb.from('clients').insert(fields);
      added += 1;
    }
  }

  revalidatePath('/staff/clients');
  return { ok: true, message: `${added} client${added === 1 ? '' : 's'} added, ${updated} updated` };
}

export async function applyStock(rows: StockRow[]): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: products }, { data: locations }] = await Promise.all([
    sb.from('products').select('id, sku'),
    sb.from('locations').select('id, name'),
  ]);

  const bySku = new Map((products ?? []).map((p) => [norm(p.sku), p.id]));
  const byLocation = new Map((locations ?? []).map((l) => [l.name.trim().toLowerCase(), l.id]));

  const upserts: { product_id: string; location_id: string; qty: number }[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const productId = bySku.get(norm(row.sku ?? ''));
    const locationId = byLocation.get((row.location ?? '').trim().toLowerCase());
    if (!productId || !locationId || !Number.isFinite(row.qty)) {
      skipped.push(row.sku);
      continue;
    }
    upserts.push({ product_id: productId, location_id: locationId, qty: Math.max(0, Math.floor(row.qty)) });
  }

  if (upserts.length) {
    const { error } = await sb.from('stock_levels')
      .upsert(upserts, { onConflict: 'product_id,location_id' });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/staff/catalogue');
  return {
    ok: true,
    message: `${upserts.length} stock line${upserts.length === 1 ? '' : 's'} updated` +
      (skipped.length ? `, ${skipped.length} skipped (unknown SKU or site)` : ''),
  };
}

// ── categorisation ──────────────────────────────────────────────────────────

/**
 * Assigns categories to products that do not have one, from their description.
 * Runs over existing rows so a catalogue imported before categories existed
 * gets filed without re-importing. Only ever fills a blank — a category set by
 * hand is never overwritten.
 */
export async function categoriseUncategorised(): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: products }, { data: categories }] = await Promise.all([
    sb.from('products').select('id, sku, name, brand').is('category_id', null),
    sb.from('categories').select('id, slug'),
  ]);

  const categoryId = new Map((categories ?? []).map((c) => [c.slug, c.id]));
  const updates = new Map<string, string[]>();

  for (const p of products ?? []) {
    const slug = classifyProduct({ name: p.name, brand: p.brand, sku: p.sku });
    const id = slug ? categoryId.get(slug) : undefined;
    if (!id) continue;
    if (!updates.has(id)) updates.set(id, []);
    updates.get(id)!.push(p.id);
  }

  let filed = 0;
  for (const [id, productIds] of updates) {
    const { error } = await sb.from('products').update({ category_id: id }).in('id', productIds);
    if (error) return { ok: false, error: error.message };
    filed += productIds.length;
  }

  const left = (products?.length ?? 0) - filed;
  revalidatePath('/staff/catalogue');
  revalidatePath('/staff/import');
  return {
    ok: true,
    message: `${filed} product${filed === 1 ? '' : 's'} categorised` +
      (left > 0 ? `, ${left} left uncategorised — set those by hand on the Catalogue screen` : ''),
  };
}

/** Staff override for a single product. */
export async function setProductCategory(
  productId: string,
  categoryId: string | null,
): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();
  const { error } = await sb.from('products').update({ category_id: categoryId }).eq('id', productId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/catalogue');
  return { ok: true };
}

/**
 * Loads orders that happened before this system existed.
 *
 * Rows are grouped into orders by their reference, or by client and date where
 * a sheet gives no reference — which is how an old spreadsheet usually reads,
 * one line per row with the order implied by repetition.
 *
 * Each order lands settled and complete on the date it actually happened: no
 * stock moves, no supplier order follows, and nothing is emailed to anyone.
 */
export async function applyHistoricOrders(rows: HistoricOrderRow[]): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data: clients } = await sb.from('clients').select('id, name, email');
  const byName = new Map<string, string>();
  for (const c of clients ?? []) {
    byName.set(norm(c.name), c.id);
    if (c.email) byName.set(norm(c.email), c.id);
  }

  // Grouped before anything is written, so a sheet naming an unknown client is
  // reported whole rather than half-imported.
  const groups = new Map<string, { clientId: string; date: string; reference: string | null;
                                   lines: { sku: string; name?: string; qty: number; unit_price: number }[] }>();
  const problems: string[] = [];

  rows.forEach((r, i) => {
    const line = i + 2;
    const clientId = byName.get(norm(r.client ?? ''));
    if (!clientId) { problems.push(`row ${line}: no client matching "${r.client}"`); return; }
    if (!r.date?.trim()) { problems.push(`row ${line}: no order date`); return; }
    const date = r.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      problems.push(`row ${line}: date "${date}" is not YYYY-MM-DD`); return;
    }
    if (!r.sku?.trim()) { problems.push(`row ${line}: no SKU`); return; }
    if (!Number.isFinite(r.qty) || r.qty <= 0) { problems.push(`row ${line}: quantity is not a number`); return; }
    if (!Number.isFinite(r.unit_price)) {
      problems.push(`row ${line}: no price — a past order must say what was charged`); return;
    }

    const reference = r.reference?.trim() || null;
    const key = reference ? `${clientId}|${reference}` : `${clientId}|${date}`;
    const group = groups.get(key) ?? { clientId, date, reference, lines: [] };
    group.lines.push({
      sku: r.sku.trim(), name: r.name?.trim() || undefined,
      qty: Math.round(r.qty), unit_price: r.unit_price,
    });
    groups.set(key, group);
  });

  if (problems.length) {
    return {
      ok: false,
      error: `Nothing was imported. ${problems.length} row${problems.length === 1 ? '' : 's'} `
           + `need attention: ${problems.slice(0, 5).join('; ')}`
           + (problems.length > 5 ? `; and ${problems.length - 5} more` : ''),
    };
  }
  if (!groups.size) return { ok: false, error: 'There was nothing to import' };

  let made = 0;
  for (const g of groups.values()) {
    const { error } = await sb.rpc('import_historic_order', {
      p_client_id: g.clientId,
      p_date: g.date,
      p_lines: g.lines,
      p_number: g.reference,
      p_notes: 'Imported from a past record',
    });
    // Stops at the first refusal rather than pressing on: a half-loaded
    // history is harder to make sense of than none.
    if (error) {
      return {
        ok: false,
        error: made
          ? `${made} order${made === 1 ? '' : 's'} imported, then stopped: ${error.message}`
          : error.message,
      };
    }
    made += 1;
  }

  revalidatePath('/staff/orders');
  revalidatePath('/portal/orders');
  revalidatePath('/portal/history');
  return {
    ok: true,
    message: `${made} past order${made === 1 ? '' : 's'} added from ${rows.length} rows`,
  };
}
