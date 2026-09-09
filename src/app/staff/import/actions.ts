'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { SUSPICIOUS_DELTA, type ClientRow, type ImportScope, type PriceChange,
         type PricePreview, type PriceRow, type StockRow, type ColumnMapping } from '@/lib/import/types';
import type { ActionResult } from '../actions';

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
      const { data: inserted, error } = await sb.from('products')
        .insert([...unique.values()].map((r) => ({
          sku: r.sku.trim(), name: r.name?.trim() || r.sku.trim(), brand: r.brand?.trim() || null,
        })))
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
