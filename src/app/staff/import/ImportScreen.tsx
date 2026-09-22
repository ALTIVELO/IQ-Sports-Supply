'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { today } from '@/lib/format';
import {
  parseWorkbook, columnLetters, guessMapping, guessCatalogueColumns, sameHeaders,
  unclaimedMoneyColumns, extractRows, toNumber, type ParsedSheet,
} from '@/lib/import/parse';
import {
  BREAK_COST, breakKey, tierKey,
  type CatalogueRow, type CataloguePreview, type ColumnMapping, type CostPreview,
  type ImportScope, type PricePreview, type SheetPlan,
} from '@/lib/import/types';
import { previewCatalogue, applyCatalogue, applyClients, applyStock,
         applyHistoricOrders, saveTemplate } from './actions';
import Restated from './Restated';

interface Named { id: string; name: string }
interface Template {
  scope: string; tier_id: string | null; header_row: number;
  mapping: ColumnMapping;
  /** The headers this layout was saved against; empty on layouts from before. */
  header_labels?: string[];
}
type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;
type Plan = SheetPlan & { include: boolean };

/**
 * A date as a spreadsheet hands it over — 14/03/2025, 2025-03-14, or the
 * serial number Excel keeps underneath — read into the one form the import
 * accepts. Anything unrecognised is passed through untouched so the server
 * reports it rather than this quietly inventing a date.
 */
export function normaliseDate(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Excel's day count, from the last day of 1899 it wrongly thinks existed.
  if (/^\d{5}$/.test(text)) {
    const ms = (Number(text) - 25569) * 86400000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return text;
}

interface Field { key: string; label: string; required: boolean }

const FIXED_FIELDS: Record<ImportScope, Field[]> = {
  prices: [
    { key: 'sku', label: 'SKU', required: true },
    { key: 'name', label: 'Product name', required: false },
    { key: 'brand', label: 'Brand', required: false },
    { key: 'series', label: 'Series (Dura-Ace, Ultegra)', required: false },
    { key: 'category', label: 'Category', required: false },
    { key: 'image_url', label: 'Image URL', required: false },
    { key: 'currency', label: 'Currency', required: false },
    { key: 'variant_group', label: 'Model (groups sizes)', required: false },
    { key: 'variant_label', label: 'Size', required: false },
    { key: 'price_note', label: 'Price note', required: false },
    { key: 'moq', label: 'Outer (minimum for the advertised price)', required: false },
    { key: BREAK_COST, label: 'Our cost under the outer', required: false },
    { key: 'cost', label: 'Our cost', required: false },
  ],
  clients: [
    { key: 'name', label: 'Client name', required: true },
    { key: 'tier', label: 'Tier', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'vat_no', label: 'VAT number', required: false },
    { key: 'address', label: 'Address', required: false },
  ],
  stock: [
    { key: 'sku', label: 'SKU', required: true },
    { key: 'location', label: 'Location', required: true },
    { key: 'qty', label: 'Quantity', required: true },
  ],
  // One line per row, the order implied by the reference repeating — which is
  // how a past order usually survives, in a spreadsheet.
  orders: [
    { key: 'client', label: 'Client (name or email)', required: true },
    { key: 'date', label: 'Order date (YYYY-MM-DD)', required: true },
    { key: 'reference', label: 'Their order reference', required: false },
    { key: 'sku', label: 'SKU', required: true },
    { key: 'name', label: 'Product name', required: false },
    { key: 'qty', label: 'Quantity', required: true },
    { key: 'unit_price', label: 'Unit price charged', required: true },
  ],
};

/**
 * The columns to ask about. A price file gets one selector per tier after the
 * fixed fields, so a single sheet can carry the whole price book — our cost
 * beside what each kind of customer pays for the same thing.
 */
function fieldsFor(scope: ImportScope, tiers: Named[]): Field[] {
  if (scope !== 'prices') return FIXED_FIELDS[scope];
  return [
    ...FIXED_FIELDS.prices,
    // Two per tier, the loose price first, which is the order the sheet puts
    // them in and the order the screens show them in.
    ...tiers.flatMap((t) => [
      { key: breakKey(t.id), label: `${t.name} under the outer`, required: false },
      { key: tierKey(t.id), label: `${t.name} price`, required: false },
    ]),
  ];
}

export default function ImportScreen({
  tiers, locations, templates,
}: { tiers: Named[]; locations: Named[]; templates: Template[] }) {
  const [scope, setScope] = useState<ImportScope>('prices');
  const [filename, setFilename] = useState('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  // On by default: pricing something is as clear a statement of intent to sell
  // it as there is, and the alternative is an import that lands on a withdrawn
  // product in silence.
  const [reactivateWithdrawn, setReactivateWithdrawn] = useState(true);
  // Off by default. A price list routinely carries an empty Image column on
  // every row, and reading those as deletions would empty the catalogue of
  // photographs on an import that looked like it only changed prices.
  const [clearBlanks, setClearBlanks] = useState(false);
  const [preview, setPreview] = useState<CataloguePreview | null>(null);
  const [message, setMessage] = useState<Msg>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const fields = useMemo(() => fieldsFor(scope, tiers), [scope, tiers]);

  // One saved layout per scope now: a price file describes every tier at once,
  // so there is no longer a mapping per tier to keep apart.
  const savedTemplate = useCallback(
    // tier_id is null for every layout saved now. A row still keyed to a tier
    // is from before a price file could describe all of them, and its mapping
    // no longer means what it says.
    () => templates.find((t) => t.scope === scope && t.tier_id === null),
    [templates, scope],
  );

  const mappingFor = useCallback(
    (sheetName: string, header: string[]): ColumnMapping => {
      const base = guessMapping(header, FIXED_FIELDS[scope].map((f) => f.key));
      if (scope !== 'prices') return base;
      return { ...base, ...guessCatalogueColumns(header, sheetName, tiers, base) };
    },
    [scope, tiers],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setMessage(null);
      setPreview(null);
      try {
        const parsed = await parseWorkbook(file);
        setFilename(file.name);
        setSheets(parsed);

        const saved = savedTemplate();
        const next: Record<string, Plan> = {};
        let reguessed = false;
        for (const sheet of parsed) {
          const headerRow = saved?.header_row ?? 1;
          const header = sheet.grid[headerRow - 1] ?? [];
          /*
           * The saved layout only applies to the sheet it was saved from.
           *
           * It is a set of column letters. Against a sheet with a column
           * inserted they still resolve, silently, to the wrong columns —
           * which is worse than not having them, because the guess that would
           * have read the new headers correctly never runs.
           */
          const fits = saved ? sameHeaders(saved.header_labels, header) : false;
          if (saved && !fits) reguessed = true;
          const mapping = fits && saved ? saved.mapping : mappingFor(sheet.name, header);
          next[sheet.name] = {
            sheetName: sheet.name,
            headerRow,
            mapping,
            // A workbook usually has a tab or two that are not product data at
            // all — a summary, terms, a blank. No SKU column means no SKUs, so
            // it starts unticked rather than reporting every row as broken.
            include: parsed.length === 1 || Boolean(mapping.sku),
          };
        }
        setPlans(next);

        // A saved layout quietly not being used is its own kind of surprise,
        // so it is said out loud rather than left to be noticed in a preview.
        const relaid = reguessed
          ? ' · this sheet has different columns from the one your saved layout '
            + 'was set up for, so the columns were read afresh — check them below'
          : '';
        const read = `${parsed.length} sheet${parsed.length === 1 ? '' : 's'} `
                   + `read from ${file.name}${relaid}`;
        if (scope !== 'prices') {
          setMessage({ tone: reguessed ? 'info' : 'info', text: read });
          return;
        }

        const matched = new Set(Object.values(next).flatMap((p) =>
          Object.keys(p.mapping).filter((k) => k.startsWith('price:') && p.mapping[k]))).size;
        const costed = Object.values(next).some((p) => p.mapping.cost);

        // A supplier's list has one price column and no clue whose price it
        // is. Rather than guess, name it and ask — that is a five-second job
        // once, and the mapping is saved.
        const spare = parsed.flatMap((sheet) => {
          const plan = next[sheet.name];
          if (!plan.include) return [];
          return unclaimedMoneyColumns(sheet.grid[plan.headerRow - 1] ?? [], plan.mapping);
        });

        setMessage(matched === 0 && !costed && spare.length > 0
          ? {
              tone: 'info',
              text: `${read}. Nothing on it says whose price is whose — point `
                + `${spare.map((c) => `column ${c.letter} (${c.label})`).join(' and ')} `
                + 'at a tier, or at our cost, below.',
            }
          : {
              tone: 'info',
              text: `${read} · ${matched} tier${matched === 1 ? '' : 's'} matched to a column`
                + (costed ? ', cost column found' : ', no cost column found'),
            });
      } catch (e) {
        setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not read that file' });
      }
    },
    [scope, savedTemplate, mappingFor],
  );

  function updatePlan(sheetName: string, patch: Partial<Plan>) {
    setPreview(null);
    setPlans((p) => ({ ...p, [sheetName]: { ...p[sheetName], ...patch } }));
  }

  const included = useMemo(
    () => sheets.filter((s) => plans[s.name]?.include),
    [sheets, plans],
  );

  /** Every column on an included sheet that holds a price or a cost. */
  const pricedColumns = useMemo(
    () => included.flatMap((s) => {
      const m = plans[s.name]?.mapping ?? {};
      return Object.keys(m).filter((k) => (k === 'cost' || k.startsWith('price:')) && m[k]);
    }),
    [included, plans],
  );

  /** Turns each included sheet into the rows the server will compare. */
  function buildSheets(): { rows: CatalogueRow[] }[] {
    return included.map((s) => {
      const plan = plans[s.name];
      const raw = extractRows(s.grid, plan.headerRow, plan.mapping);
      return {
        rows: raw.map((r) => {
          // A blank cell is silence: the row simply does not price that tier.
          // Something unreadable in it is a problem, and reaches the server as
          // NaN so it can be reported rather than guessed at.
          const prices: Record<string, number> = {};
          // And the price beside it, for a quantity below the outer. Read the
          // same way and kept apart, because a tier priced by the outer with
          // nothing said about loose units is the ordinary case.
          const breakPrices: Record<string, number> = {};
          for (const tier of tiers) {
            const cell = r[tierKey(tier.id)];
            if (cell) prices[tier.id] = toNumber(cell);
            const loose = r[breakKey(tier.id)];
            if (loose) breakPrices[tier.id] = toNumber(loose);
          }
          return {
            sku: r.sku ?? '',
            name: r.name ?? '',
            brand: r.brand ?? '',
            category: r.category ?? '',
            image_url: r.image_url ?? '',
            currency: r.currency ?? '',
            variant_group: r.variant_group ?? '',
            variant_label: r.variant_label ?? '',
            price_note: r.price_note ?? '',
            // A blank outer is a part sold in ones, which is what an absent
            // column already means, so both arrive as silence.
            moq: r.moq ? toNumber(r.moq) : undefined,
            cost: r.cost ? toNumber(r.cost) : undefined,
            breakCost: r[BREAK_COST] ? toNumber(r[BREAK_COST]) : undefined,
            prices,
            breakPrices,
          };
        }),
      };
    });
  }

  function doPreview() {
    if (!pricedColumns.length) {
      setMessage({
        tone: 'error',
        text: 'Point at least one column at a tier, or at our cost, before previewing',
      });
      return;
    }
    startTransition(async () => {
      const r = await previewCatalogue(buildSheets(), effectiveFrom, clearBlanks);
      if (r.ok) {
        setPreview(r.preview);
        setMessage(null);
      } else {
        setMessage({ tone: 'error', text: r.error });
      }
    });
  }

  function doApply() {
    startTransition(async () => {
      const r = await applyCatalogue({
        sheets: buildSheets(), effectiveFrom, filename,
        deactivateMissing, reactivateWithdrawn, clearBlanks,
      });
      setMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Applied' }
        : { tone: 'error', text: r.error ?? 'Could not apply the import' });
      if (r.ok) { setPreview(null); setSheets([]); setPlans({}); setFilename(''); }
    });
  }

  function doApplyOther() {
    startTransition(async () => {
      const sheet = included[0];
      if (!sheet) return;
      const plan = plans[sheet.name];
      const raw = extractRows(sheet.grid, plan.headerRow, plan.mapping);

      const r = scope === 'clients'
        ? await applyClients(raw.map((x) => ({
            name: x.name ?? '', email: x.email ?? '', tier: x.tier ?? '',
            vat_no: x.vat_no ?? '', address: x.address ?? '', phone: x.phone ?? '',
          })))
        : scope === 'orders'
          ? await applyHistoricOrders(raw.map((x) => ({
              client: x.client ?? '', date: normaliseDate(x.date ?? ''),
              reference: x.reference ?? '', sku: x.sku ?? '', name: x.name ?? '',
              qty: toNumber(x.qty ?? ''), unit_price: toNumber(x.unit_price ?? ''),
            })))
          : await applyStock(raw.map((x) => ({
              sku: x.sku ?? '', location: x.location ?? '', qty: toNumber(x.qty ?? ''),
            })));

      setMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Applied' }
        : { tone: 'error', text: r.error ?? 'Could not apply the import' });
      if (r.ok) { setSheets([]); setPlans({}); setFilename(''); }
    });
  }

  function persistMapping(sheetName: string) {
    const plan = plans[sheetName];
    // The headers go with it. Without them the letters get applied to next
    // quarter's sheet whatever shape it turns out to be.
    const header = sheets.find((s) => s.name === sheetName)
      ?.grid[plan.headerRow - 1] ?? [];
    startTransition(async () => {
      const r = await saveTemplate({
        scope, tierId: null, headerRow: plan.headerRow, mapping: plan.mapping,
        headerLabels: header.map((c) => String(c ?? '')),
      });
      setMessage(r.ok
        ? { tone: 'success', text: 'Mapping saved — next quarter is drag-and-drop, '
                                + 'as long as the sheet keeps these columns' }
        : { tone: 'error', text: r.error ?? 'Could not save the mapping' });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['prices', 'clients', 'stock', 'orders'] as ImportScope[]).map((s) => (
          <button
            key={s}
            onClick={() => { setScope(s); setSheets([]); setPlans({}); setPreview(null); setMessage(null); }}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${scope === s ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-parch'}`}
          >
            {s === 'prices' ? 'SKUs, prices & cost'
              : s === 'clients' ? 'Client list'
                : s === 'stock' ? 'Stock by location' : 'Past orders'}
          </button>
        ))}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card className={dragging ? 'border-flame bg-flame-tint' : ''}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className="border-2 border-dashed border-line rounded p-8 text-center"
        >
          <p className="text-[14px] font-semibold">Drop an .xlsx or .csv file here</p>
          <p className="text-[12px] text-mute mt-1">
            {scope === 'prices'
              ? 'One row per SKU, with a column for what we pay and a column for each tier. '
                + 'Columns are matched to tiers by their headings; a tab per tier still works too.'
              : scope === 'clients'
                ? 'Columns for client name and tier are required.'
                : scope === 'stock'
                  ? 'One row per SKU and location, with a quantity.'
                  : 'One row per order line. Rows sharing a reference — or a client and a date '
                    + 'where there is none — become one order, dated when it happened and '
                    + 'already settled. No stock moves and nothing is emailed.'}
          </p>
          <label className="inline-block mt-4">
            <span className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch cursor-pointer">
              Choose a file
            </span>
            <input
              type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
        </div>
      </Card>

      {sheets.length > 0 && (
        <>
          {sheets.map((sheet) => {
            const plan = plans[sheet.name];
            if (!plan) return null;
            const letters = columnLetters(sheet.grid);
            const header = sheet.grid[plan.headerRow - 1] ?? [];
            const rows = extractRows(sheet.grid, plan.headerRow, plan.mapping).slice(0, 3);

            return (
              <Card key={sheet.name} className={plan.include ? '' : 'opacity-60'}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <input
                      type="checkbox" checked={plan.include}
                      onChange={(e) => updatePlan(sheet.name, { include: e.target.checked })}
                    />
                    {sheet.name}
                  </label>
                  <span className="text-[12px] text-mute">{sheet.grid.length} rows</span>

                  <label className="text-[12px] flex items-center gap-1.5">
                    Header row
                    <input
                      type="number" min={1} className="num w-[70px]" value={plan.headerRow}
                      onChange={(e) => {
                        const headerRow = Math.max(1, Number(e.target.value) || 1);
                        const nextHeader = sheet.grid[headerRow - 1] ?? [];
                        updatePlan(sheet.name, {
                          headerRow,
                          mapping: mappingFor(sheet.name, nextHeader),
                        });
                      }}
                    />
                  </label>

                  <Button
                    small kind="ghost" className="ml-auto" disabled={pending}
                    onClick={() => persistMapping(sheet.name)}
                  >
                    Save this mapping
                  </Button>
                </div>

                {plan.include && (
                  <>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                      {fields.map((field) => (
                        <label key={field.key} className="text-[12px]">
                          <span className="block font-semibold mb-1">
                            {field.label}
                            {field.required && <span className="text-danger"> *</span>}
                          </span>
                          <select
                            value={plan.mapping[field.key] ?? ''}
                            onChange={(e) =>
                              updatePlan(sheet.name, {
                                mapping: { ...plan.mapping, [field.key]: e.target.value || undefined },
                              })
                            }
                          >
                            <option value="">— not mapped —</option>
                            {letters.map((letter, i) => (
                              <option key={letter} value={letter}>
                                {letter}{header[i] ? ` · ${header[i].slice(0, 24)}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>

                    {rows.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-1">
                          First rows as mapped
                        </div>
                        <table>
                          <thead>
                            <tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr>
                          </thead>
                          <tbody>
                            {rows.map((row, i) => (
                              <tr key={i}>
                                {fields.map((f) => (
                                  <td key={f.key} className="num">{row[f.key] || '—'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </Card>
            );
          })}

          <Card className="flex flex-wrap items-end gap-3">
            {scope === 'prices' && (
              <>
                <label className="text-[12px]">
                  <span className="block font-semibold mb-1">Effective from</span>
                  <input
                    type="date" className="w-[170px]" value={effectiveFrom}
                    onChange={(e) => { setEffectiveFrom(e.target.value); setPreview(null); }}
                  />
                  <span className="block text-[11px] text-mute mt-1">
                    Upload next quarter early — prices switch over on this date on their own.
                  </span>
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox" checked={reactivateWithdrawn}
                      onChange={(e) => setReactivateWithdrawn(e.target.checked)}
                    />
                    Bring back any withdrawn SKU this file prices
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox" checked={deactivateMissing}
                      onChange={(e) => setDeactivateMissing(e.target.checked)}
                    />
                    Mark SKUs missing from the sheet inactive
                  </label>
                  <label className="flex items-start gap-1.5 text-[12px]">
                    <input
                      type="checkbox" checked={clearBlanks} className="mt-[3px]"
                      onChange={(e) => setClearBlanks(e.target.checked)}
                    />
                    <span>
                      Let blank cells clear what we hold
                      <span className="block text-[11px] text-mute">
                        Off, a column left empty is left alone — so a photograph you
                        uploaded survives a price list that has no images in it. On,
                        this sheet is the whole truth about the SKUs on it.
                      </span>
                    </span>
                  </label>
                </div>
                <Button small kind="ghost" onClick={doPreview} disabled={pending}>
                  {pending ? 'Checking…' : 'Preview changes'}
                </Button>
                <Button small kind="accent" onClick={doApply} disabled={pending || !preview}>
                  Apply
                </Button>
              </>
            )}
            {scope !== 'prices' && (
              <Button small kind="accent" onClick={doApplyOther} disabled={pending || !included.length}>
                {pending ? 'Importing…'
                  : `Import ${scope === 'clients' ? 'clients'
                      : scope === 'orders' ? 'past orders' : 'stock'}`}
              </Button>
            )}
          </Card>
        </>
      )}

      {preview && <PreviewCards preview={preview} />}
    </div>
  );
}

function PreviewCards({ preview }: { preview: CataloguePreview }) {
  return (
    <>
      {preview.invalid.length > 0 && (
        <Notice>
          {preview.invalid.length} row{preview.invalid.length === 1 ? '' : 's'} skipped:{' '}
          {preview.invalid.slice(0, 3).map((i) => `row ${i.row} (${i.reason})`).join(', ')}
          {preview.invalid.length > 3 ? '…' : ''}
        </Notice>
      )}

      {preview.notes.map((note) => (
        <Notice tone="info" key={note}>{note}</Notice>
      ))}

      {preview.costs && <CostCard costs={preview.costs} />}

      {preview.tiers.map((t) => <TierCard key={t.tierId} preview={t} />)}

      {preview.withdrawn.length > 0 && <Withdrawn withdrawn={preview.withdrawn} />}

      {preview.currencyChanges.length > 0 && (
        <Redenominated changes={preview.currencyChanges} />
      )}

      {preview.restated.length > 0 && <Restated preview={preview} />}

      {preview.newSkus.length > 0 && (
        <Card>
          <Bucket title={`New SKUs to be created (${preview.newSkus.length})`}>
            <p className="text-[12px] num">
              {preview.newSkus.slice(0, 60).map((r) => r.sku).join(' · ')}
              {preview.newSkus.length > 60 ? ` … and ${preview.newSkus.length - 60} more` : ''}
            </p>
          </Bucket>
        </Card>
      )}

      {preview.missing.length > 0 && (
        <Card>
          <Bucket title={`In the system but not in this file (${preview.missing.length})`}>
            <p className="text-[12px] text-mute mb-2">
              Reported only. Nothing is ever deleted by an import.
            </p>
            <p className="text-[12px] num">
              {preview.missing.slice(0, 40).map((m) => m.sku).join(' · ')}
              {preview.missing.length > 40 ? ` … and ${preview.missing.length - 40} more` : ''}
            </p>
          </Bucket>
        </Card>
      )}
    </>
  );
}

/**
 * SKUs in the file that the catalogue already has, withdrawn.
 *
 * A withdrawn product was sold once, so it could not be deleted — the SKU is
 * still taken and customers cannot see it. Landing prices on one silently is
 * the worst outcome available: the import reports success, and the product
 * everybody expected to appear does not. So it is named here, before applying.
 */
function Withdrawn({ withdrawn }: { withdrawn: { sku: string; name: string }[] }) {
  const one = withdrawn.length === 1;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Tag tone="red">Withdrawn</Tag>
        <span className="text-[12px]">
          <strong>{withdrawn.length}</strong> SKU{one ? '' : 's'} in this file
          {one ? ' is' : ' are'} in the catalogue but withdrawn
        </span>
      </div>
      <p className="text-[12px] text-mute mb-2 max-w-3xl">
        {one ? 'It was' : 'They were'} sold at least once, so {one ? 'it' : 'they'} could
        not be deleted — only taken off sale. Pricing {one ? 'it' : 'them'} here is a
        fair sign {one ? 'it is' : 'they are'} wanted again, so &ldquo;bring back any
        withdrawn SKU this file prices&rdquo; is ticked above. Untick it and the prices
        still land, but {one ? 'it stays' : 'they stay'} off sale.
      </p>
      <p className="text-[12px] num">
        {withdrawn.slice(0, 40).map((w) => w.sku).join(' · ')}
        {withdrawn.length > 40 ? ` … and ${withdrawn.length - 40} more` : ''}
      </p>
    </Card>
  );
}

/**
 * Products this file would move to a different currency.
 *
 * Worth a card of its own because nothing is converted: £1,200 becomes €1,200,
 * the same figure under a different symbol. That is exactly right the first
 * time a supplier's own list arrives in their money, and a several-thousand
 * pound error if the column was pointed at the wrong thing — and either way
 * the preview above shows only the numbers, which do not change.
 */
function Redenominated({ changes }: {
  changes: { sku: string; name: string; from: string; to: string }[];
}) {
  const one = changes.length === 1;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Tag tone="red">Currency</Tag>
        <span className="text-[12px]">
          <strong>{changes.length}</strong> product{one ? '' : 's'} would change currency
        </span>
      </div>
      <p className="text-[12px] text-mute mb-2 max-w-3xl">
        Nothing is converted. The figures stay as they are and the symbol in front
        of them changes, so a price reading £1,200 today reads €1,200 afterwards.
        Check this is a list in the supplier&rsquo;s own money and not a column
        mapped by mistake.
      </p>
      <p className="text-[12px] num">
        {changes.slice(0, 40).map((c) => `${c.sku} ${c.from}→${c.to}`).join(' · ')}
        {changes.length > 40 ? ` … and ${changes.length - 40} more` : ''}
      </p>
    </Card>
  );
}

/**
 * What we would be paying, and — the part worth stopping for — anything this
 * file would have us selling at or below what it costs us.
 */
function CostCard({ costs }: { costs: CostPreview }) {
  const flagged = costs.changed.filter((c) => c.suspicious);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Tag tone="line">Our cost</Tag>
        <span className="text-[12px]">
          <strong>{costs.created}</strong> on new SKUs ·{' '}
          <strong>{costs.changed.length}</strong> changed ·{' '}
          <strong>{costs.unchanged}</strong> unchanged
        </span>
        {flagged.length > 0 && <Tag tone="red">{flagged.length} to check</Tag>}
      </div>

      {costs.belowCost.length > 0 && (
        <div className="mb-3">
          <Notice>
            {costs.belowCost.length} price{costs.belowCost.length === 1 ? '' : 's'} at or below
            what we pay — selling these loses money. Check the columns are the right way round
            before applying.
          </Notice>
          <div className="overflow-x-auto max-h-[240px] overflow-y-auto mt-2">
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Product</th><th>Tier</th>
                  <th className="text-right">Cost</th><th className="text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {costs.belowCost.slice(0, 50).map((b, i) => (
                  <tr key={`${b.sku}-${b.tierName}-${i}`}>
                    <td className="num font-semibold">{b.sku}</td>
                    <td>{b.name}</td>
                    <td>{b.tierName}</td>
                    <td className="num text-right">
                      <Money value={b.cost} currency={b.currency} />
                    </td>
                    <td className="num text-right text-danger font-semibold">
                      <Money value={b.price} currency={b.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {costs.changed.length > 0
        ? <ChangeTable title={`Cost changes (${costs.changed.length})`} changes={costs.changed} />
        : costs.belowCost.length === 0 && (
          <Empty>Nothing to change — every cost in this file already matches.</Empty>
        )}
    </Card>
  );
}

function TierCard({ preview }: { preview: PricePreview }) {
  const flagged = preview.changed.filter((c) => c.suspicious);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Tag tone="accent">{preview.tierName}</Tag>
        <span className="text-[12px]">
          <strong>{preview.created}</strong> on new SKUs ·{' '}
          <strong>{preview.changed.length}</strong> changed ·{' '}
          <strong>{preview.unchanged}</strong> unchanged
        </span>
        {flagged.length > 0 && <Tag tone="red">{flagged.length} to check</Tag>}
      </div>

      {preview.changed.length > 0
        ? <ChangeTable title={`Price changes (${preview.changed.length})`} changes={preview.changed} />
        : <Empty>Nothing to change — every {preview.tierName} price already matches.</Empty>}
    </Card>
  );
}

function ChangeTable({ title, changes }: {
  title: string; changes: PricePreview['changed'];
}) {
  const flagged = changes.filter((c) => c.suspicious);
  return (
    <Bucket title={title}>
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Product</th>
            <th className="text-right">Old</th><th className="text-right">New</th>
            <th className="text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {[...changes]
            .sort((a, b) => Number(b.suspicious) - Number(a.suspicious))
            .slice(0, 100)
            .map((c) => (
              <tr key={c.sku} className={c.suspicious ? 'bg-[#FDF2F0]' : ''}>
                <td className="num font-semibold">{c.sku}</td>
                <td>{c.name}</td>
                <td className="num text-right text-mute">
                  <Money value={c.oldPrice} currency={c.currency} />
                </td>
                <td className="num text-right font-semibold">
                  <Money value={c.newPrice} currency={c.currency} />
                </td>
                <td className={`num text-right ${c.suspicious ? 'text-danger font-semibold' : 'text-mute'}`}>
                  {c.deltaPct > 0 ? '+' : ''}{c.deltaPct.toFixed(1)}%
                  {c.suspicious && ' ⚠'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {flagged.length > 0 && (
        <p className="text-[11px] text-danger mt-2">
          Highlighted rows move by more than ±25% — worth a second look before applying.
        </p>
      )}
    </Bucket>
  );
}

function Bucket({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-line pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0" open>
      <summary className="text-[12px] font-semibold cursor-pointer mb-2">{title}</summary>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">{children}</div>
    </details>
  );
}
