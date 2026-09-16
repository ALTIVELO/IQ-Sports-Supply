'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { SUSPICIOUS_DELTA, type ClientRow, type ImportScope, type PriceChange,
         type PricePreview, type PriceRow, type StockRow, type HistoricOrderRow,
         type ColumnMapping } from '@/lib/import/types';
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

// ── price import ────────────────────────────────────────────────────────────

/**
 * Compares a sheet against what is already in the system. Reads only — nothing
 * is written until the user applies the preview.
 */
export async function previewPrices(
  sheets: { tierId: string; rows: PriceRow[] }[],
  effectiveFrom: string,
): Promise<{ ok: true; previews: PricePreview[] } | { ok: false; error: string }> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: products }] = await Promise.all([
    sb.from('tiers').select('id, name'),
    sb.from('products').select('id, sku, name').eq('active', true),
  ]);

  const bySku = new Map((products ?? []).map((p) => [norm(p.sku), p]));
  const previews: PricePreview[] = [];

  for (const sheet of sheets) {
    const tier = (tiers ?? []).find((t) => t.id === sheet.tierId);
    if (!tier) return { ok: false, error: 'Unknown pricing tier on one of the sheets' };

    // Current price per product for this tier, as of the effective date.
    const { data: prices } = await sb
      .from('tier_prices')
      .select('product_id, price, effective_from')
      .eq('tier_id', tier.id)
      .lte('effective_from', effectiveFrom)
      .order('effective_from', { ascending: false });

    const currentPrice = new Map<string, number>();
    for (const p of prices ?? []) {
      if (!currentPrice.has(p.product_id)) currentPrice.set(p.product_id, Number(p.price));
    }

    const created: PriceRow[] = [];
    const changed: PriceChange[] = [];
    const invalid: { row: number; reason: string }[] = [];
    const seen = new Set<string>();
    let unchanged = 0;

    sheet.rows.forEach((row, i) => {
      const sku = row.sku?.trim();
      if (!sku) { invalid.push({ row: i + 1, reason: 'No SKU' }); return; }
      if (!Number.isFinite(row.price) || row.price < 0) {
        invalid.push({ row: i + 1, reason: `Unreadable price for ${sku}` });
        return;
      }
      const key = norm(sku);
      if (seen.has(key)) { invalid.push({ row: i + 1, reason: `${sku} appears twice` }); return; }
      seen.add(key);

      const existing = bySku.get(key);
      if (!existing) { created.push({ ...row, sku }); return; }

      const old = currentPrice.get(existing.id);
      if (old === undefined) {
        // Known product, no price on this tier yet — treated as a change from nothing.
        changed.push({
          sku: existing.sku, name: existing.name, oldPrice: 0, newPrice: row.price,
          deltaPct: 100, suspicious: false,
        });
        return;
      }
      if (Math.abs(old - row.price) < 0.005) { unchanged += 1; return; }

      const deltaPct = old === 0 ? 100 : ((row.price - old) / old) * 100;
      changed.push({
        sku: existing.sku, name: existing.name, oldPrice: old, newPrice: row.price,
        deltaPct,
        suspicious: Math.abs(deltaPct) > SUSPICIOUS_DELTA,
      });
    });

    const missing = (products ?? [])
      .filter((p) => !seen.has(norm(p.sku)))
      .map((p) => ({ sku: p.sku, name: p.name }));

    previews.push({
      tierId: tier.id, tierName: tier.name, created, changed, unchanged, missing, invalid,
    });
  }

  return { ok: true, previews };
}

/**
 * Applies a previewed import. Creates products for new SKUs and writes new
 * tier_prices rows dated to the effective date — history is preserved and
 * nothing is ever deleted.
 */
export async function applyPrices(input: {
  sheets: { tierId: string; rows: PriceRow[] }[];
  effectiveFrom: string;
  filename: string;
  deactivateMissing: boolean;
}): Promise<ActionResult> {
  const user = await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  let totalAdded = 0;
  let totalChanged = 0;

  for (const sheet of input.sheets) {
    const valid = sheet.rows.filter((r) => r.sku?.trim() && Number.isFinite(r.price) && r.price >= 0);
    if (!valid.length) continue;

    // Create any SKU the system has not seen before.
    const { data: existing } = await sb.from('products').select('id, sku');
    const bySku = new Map((existing ?? []).map((p) => [norm(p.sku), p.id]));

    const toCreate = valid.filter((r) => !bySku.has(norm(r.sku)));
    if (toCreate.length) {
      // Dedupe within the sheet before inserting.
      const unique = new Map(toCreate.map((r) => [norm(r.sku), r]));

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
        .insert([...unique.values()].map((r) => {
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
      totalAdded += inserted?.length ?? 0;
    }

    const priceRows = valid
      .map((r) => ({
        product_id: bySku.get(norm(r.sku))!,
        tier_id: sheet.tierId,
        price: r.price,
        effective_from: input.effectiveFrom,
      }))
      .filter((r) => r.product_id);

    if (priceRows.length) {
      const { error } = await sb.from('tier_prices')
        .upsert(priceRows, { onConflict: 'product_id,tier_id,effective_from' });
      if (error) return { ok: false, error: `Writing prices failed: ${error.message}` };
      totalChanged += priceRows.length;
    }

    if (input.deactivateMissing) {
      const present = new Set(valid.map((r) => norm(r.sku)));
      const stale = (existing ?? []).filter((p) => !present.has(norm(p.sku))).map((p) => p.id);
      if (stale.length) await sb.from('products').update({ active: false }).in('id', stale);
    }

    await sb.from('price_imports').insert({
      tier_id: sheet.tierId,
      filename: input.filename,
      rows_added: totalAdded,
      rows_changed: priceRows.length,
      effective_from: input.effectiveFrom,
      applied_by: user.id,
    });
  }

  revalidatePath('/staff/catalogue');
  revalidatePath('/staff/import');
  return {
    ok: true,
    message: `Applied — ${totalAdded} new SKU${totalAdded === 1 ? '' : 's'}, ${totalChanged} price row${totalChanged === 1 ? '' : 's'} effective ${input.effectiveFrom}`,
  };
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
