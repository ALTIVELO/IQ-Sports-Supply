/**
 * What a re-issued price list restates about a SKU we already hold.
 *
 * A supplier's list is the authority on their own products: what they are
 * called, which brand and range they belong to, which shelf they sit on, what
 * they look like, and which model they are a size of. So a re-issue is how a
 * catalogue gets tidied, rather than a thing that prices the rows and leaves
 * somebody to redo the rest by hand.
 *
 * The rule turns on three states, and the difference between the last two is
 * the whole of it:
 *
 *   absent  the sheet has no such column — it says nothing, so nothing moves;
 *   blank   the column is there and this cell is empty — an instruction to
 *           clear, but only when the import was told to take blanks that way;
 *   filled  replaces what we hold.
 *
 * Blanks are silence by default because a price list routinely carries an
 * empty Image column for every row, and a photograph uploaded on the
 * Catalogue screen must survive next quarter's list. Reading those blanks as
 * deletions would empty the catalogue of pictures on an import that looked
 * like it only changed prices.
 *
 * One rule, returned as a list rather than applied, so the preview counts the
 * same changes the apply then makes. An import that alters something the
 * preview never mentioned is an import nobody can check.
 */
import type { CatalogueRow } from './types';

/** The columns a sheet is allowed to restate, as the product holds them. */
export interface ProductNow {
  name: string;
  brand: string | null;
  /** The carton quantity, one where the part is sold in ones. */
  moq: number;
  series: string | null;
  image_url: string | null;
  price_note: string | null;
  category_id: string | null;
  variant_group: string | null;
  variant_label: string | null;
}

export interface Restatement {
  /** The column, named as the screen names it. */
  field: 'name' | 'brand' | 'series' | 'image' | 'price note' | 'collection' | 'size'
       | 'outer';
  /** The database column, or columns where one change moves several. */
  patch: Record<string, unknown>;
  from: string | null;
  to: string | null;
}

export interface RestateOptions {
  /**
   * The collection this row's Category column names, already resolved.
   *
   * `undefined` where the sheet named one we do not have — which is a thing
   * to report rather than to act on, since filing a product under nothing
   * because of a typo is worse than leaving it where it was.
   */
  categoryId?: string | null;
  /** Whether a blank cell means "clear this" or means nothing. */
  clearBlanks: boolean;
}

/** Trimmed, or undefined where the column was not in the sheet at all. */
const stated = (v: string | undefined): string | undefined =>
  v === undefined ? undefined : v.trim();

const same = (a: string | null, b: string | null) => (a ?? '') === (b ?? '');

export function restatements(
  row: CatalogueRow, before: ProductNow, opts: RestateOptions,
): Restatement[] {
  const out: Restatement[] = [];

  /** One column, one rule. */
  const consider = (
    field: Restatement['field'],
    value: string | undefined,
    current: string | null,
    build: (next: string | null) => Record<string, unknown>,
    { clearable = true }: { clearable?: boolean } = {},
  ) => {
    if (value === undefined) return;
    if (value === '') {
      if (!clearable || !opts.clearBlanks || current === null) return;
      out.push({ field, patch: build(null), from: current, to: null });
      return;
    }
    if (same(value, current)) return;
    out.push({ field, patch: build(value), from: current, to: value });
  };

  // A product without a name cannot be picked off a shelf or read on an
  // invoice, so this one is never cleared however the import was set.
  consider('name', stated(row.name), before.name,
           (next) => ({ name: next }), { clearable: false });

  consider('brand', stated(row.brand), before.brand, (next) => ({ brand: next }));

  /*
   * The outer, which is a number pretending to be one of these.
   *
   * Cleared means one, not null: the column is the minimum quantity that buys
   * the advertised price, and every part has one even when it is a single.
   * Comparing as text keeps it on the same footing as the rest — a sheet
   * saying "10" against a product already at 10 is not a change.
   */
  const outer = row.moq === undefined ? undefined
    : (Number.isFinite(row.moq) && row.moq >= 1 ? String(Math.round(row.moq)) : '');
  consider('outer', outer, String(before.moq ?? 1),
           (next) => ({ moq: next === null ? 1 : Number(next) }));
  consider('series', stated(row.series), before.series, (next) => ({ series: next }));
  consider('price note', stated(row.price_note), before.price_note,
           (next) => ({ price_note: next }));

  // A sheet often carries a filename where a URL belongs, which renders as a
  // broken picture. Anything that is not a URL is not an instruction.
  const image = stated(row.image_url);
  if (image === '' || image === undefined || /^https?:\/\//i.test(image)) {
    consider('image', image, before.image_url, (next) => ({ image_url: next }));
  }

  // The collection arrives resolved, because only the caller knows what
  // collections exist. A name we could not place is left alone.
  const category = stated(row.category);
  if (category !== undefined && !(category !== '' && opts.categoryId === undefined)) {
    consider('collection',
             category === '' ? '' : (opts.categoryId ?? ''),
             before.category_id,
             (next) => ({ category_id: next }));
  }

  /*
   * The model and the size move together or not at all.
   *
   * Half a pair files a product under a model with no size, or gives it a
   * size belonging to no model — and the second of those collides with every
   * other sizeless row in the same group. Clearing is the same: a product
   * leaves its range whole.
   */
  const group = stated(row.variant_group);
  const label = stated(row.variant_label);
  if (group !== undefined && label !== undefined) {
    const blank = group === '' && label === '';
    const paired = group !== '' && label !== '';
    const was = [before.variant_group, before.variant_label].filter(Boolean).join(' · ') || null;

    if (blank && opts.clearBlanks && was !== null) {
      out.push({
        field: 'size', from: was, to: null,
        patch: { variant_group: null, variant_label: null, variant_sort: null },
      });
    } else if (paired
               && (!same(group, before.variant_group) || !same(label, before.variant_label))) {
      out.push({
        field: 'size', from: was, to: `${group} · ${label}`,
        patch: { variant_group: group, variant_label: label },
      });
    }
  }

  return out;
}

/** Every restatement's patch, merged into the one update the row needs. */
export function restatementPatch(changes: Restatement[]): Record<string, unknown> {
  return Object.assign({}, ...changes.map((c) => c.patch));
}

/**
 * The column's name for a count of rows.
 *
 * Written out rather than pluralised by adding an s, because one of them is
 * "series" — which is already plural, and came out as "108 seriess".
 */
const PLURAL: Record<Restatement['field'], string> = {
  name: 'names',
  brand: 'brands',
  series: 'series',
  image: 'images',
  'price note': 'price notes',
  collection: 'collections',
  size: 'sizes',
  outer: 'outers',
};

export function restatementLabel(field: Restatement['field'], rows: number): string {
  return rows === 1 ? field : PLURAL[field];
}

/** How many rows each column would be restated on, commonest first. */
export function restatementTally(
  perRow: Restatement[][],
): { field: Restatement['field']; rows: number }[] {
  const counts = new Map<Restatement['field'], number>();
  for (const changes of perRow) {
    for (const field of new Set(changes.map((c) => c.field))) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([field, rows]) => ({ field, rows }))
    .sort((a, b) => b.rows - a.rows || a.field.localeCompare(b.field));
}
