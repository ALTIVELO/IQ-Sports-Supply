'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { today } from '@/lib/format';
import {
  parseWorkbook, columnLetters, guessMapping, extractRows, toNumber, type ParsedSheet,
} from '@/lib/import/parse';
import type {
  ColumnMapping, ImportScope, PricePreview, PriceRow, SheetPlan,
} from '@/lib/import/types';
import { previewPrices, applyPrices, applyClients, applyStock, saveTemplate } from './actions';

interface Named { id: string; name: string }
interface Template { scope: string; tier_id: string | null; header_row: number; mapping: ColumnMapping }
type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

const FIELDS: Record<ImportScope, { key: keyof ColumnMapping; label: string; required: boolean }[]> = {
  prices: [
    { key: 'sku', label: 'SKU', required: true },
    { key: 'name', label: 'Product name', required: false },
    { key: 'brand', label: 'Brand', required: false },
    { key: 'price', label: 'Price', required: true },
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
};

export default function ImportScreen({
  tiers, locations, templates,
}: { tiers: Named[]; locations: Named[]; templates: Template[] }) {
  const [scope, setScope] = useState<ImportScope>('prices');
  const [filename, setFilename] = useState('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [plans, setPlans] = useState<Record<string, SheetPlan & { include: boolean }>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [previews, setPreviews] = useState<PricePreview[] | null>(null);
  const [message, setMessage] = useState<Msg>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const templateFor = useCallback(
    (tierId: string | null) =>
      templates.find((t) => t.scope === scope && (t.tier_id ?? null) === tierId),
    [templates, scope],
  );

  /** A tab called "Shop" is almost certainly the Shop tier's sheet. */
  const guessTier = useCallback(
    (sheetName: string) =>
      tiers.find((t) => sheetName.trim().toLowerCase().includes(t.name.toLowerCase()))?.id ?? null,
    [tiers],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setMessage(null);
      setPreviews(null);
      try {
        const parsed = await parseWorkbook(file);
        setFilename(file.name);
        setSheets(parsed);

        const next: Record<string, SheetPlan & { include: boolean }> = {};
        for (const sheet of parsed) {
          const tierId = scope === 'prices' ? guessTier(sheet.name) : null;
          const saved = templateFor(tierId);
          const headerRow = saved?.header_row ?? 1;
          const header = sheet.grid[headerRow - 1] ?? [];
          next[sheet.name] = {
            sheetName: sheet.name,
            tierId,
            headerRow,
            mapping: saved?.mapping ?? guessMapping(header, FIELDS[scope].map((f) => f.key)),
            include: parsed.length === 1 || scope !== 'prices' ? true : Boolean(tierId),
          };
        }
        setPlans(next);

        const matched = Object.values(next).filter((p) => p.include).length;
        setMessage({
          tone: 'info',
          text: `${parsed.length} sheet${parsed.length === 1 ? '' : 's'} read from ${file.name}` +
            (scope === 'prices' ? ` · ${matched} matched to a tier automatically` : ''),
        });
      } catch (e) {
        setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not read that file' });
      }
    },
    [scope, guessTier, templateFor],
  );

  function updatePlan(sheetName: string, patch: Partial<SheetPlan & { include: boolean }>) {
    setPreviews(null);
    setPlans((p) => {
      const current = p[sheetName];
      const next = { ...current, ...patch };

      // Switching tier pulls in that tier's saved mapping.
      if (patch.tierId !== undefined && patch.tierId !== current.tierId) {
        const saved = templateFor(patch.tierId ?? null);
        if (saved) {
          next.headerRow = saved.header_row;
          next.mapping = saved.mapping;
        }
      }
      return { ...p, [sheetName]: next };
    });
  }

  const included = useMemo(
    () => sheets.filter((s) => plans[s.name]?.include),
    [sheets, plans],
  );

  /** Turns each included sheet into the mapped rows the server will compare. */
  function buildPriceSheets(): { tierId: string; rows: PriceRow[] }[] {
    return included
      .filter((s) => plans[s.name].tierId)
      .map((s) => {
        const plan = plans[s.name];
        const raw = extractRows(s.grid, plan.headerRow, plan.mapping);
        return {
          tierId: plan.tierId!,
          rows: raw.map((r) => ({
            sku: r.sku ?? '',
            name: r.name ?? '',
            brand: r.brand ?? '',
            price: toNumber(r.price ?? ''),
          })),
        };
      });
  }

  function doPreview() {
    const payload = buildPriceSheets();
    if (!payload.length) {
      setMessage({ tone: 'error', text: 'Assign at least one sheet to a pricing tier first' });
      return;
    }
    startTransition(async () => {
      const r = await previewPrices(payload, effectiveFrom);
      if (r.ok) {
        setPreviews(r.previews);
        setMessage(null);
      } else {
        setMessage({ tone: 'error', text: r.error });
      }
    });
  }

  function doApply() {
    startTransition(async () => {
      const r = await applyPrices({
        sheets: buildPriceSheets(),
        effectiveFrom,
        filename,
        deactivateMissing,
      });
      setMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Applied' }
        : { tone: 'error', text: r.error ?? 'Could not apply the import' });
      if (r.ok) { setPreviews(null); setSheets([]); setPlans({}); setFilename(''); }
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
    startTransition(async () => {
      const r = await saveTemplate({
        scope, tierId: plan.tierId, headerRow: plan.headerRow, mapping: plan.mapping,
      });
      setMessage(r.ok
        ? { tone: 'success', text: 'Mapping saved — next quarter is drag-and-drop' }
        : { tone: 'error', text: r.error ?? 'Could not save the mapping' });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['prices', 'clients', 'stock'] as ImportScope[]).map((s) => (
          <button
            key={s}
            onClick={() => { setScope(s); setSheets([]); setPlans({}); setPreviews(null); setMessage(null); }}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${scope === s ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-parch'}`}
          >
            {s === 'prices' ? 'SKUs & prices' : s === 'clients' ? 'Client list' : 'Stock by location'}
          </button>
        ))}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card
        className={dragging ? 'border-cobalt bg-[#F0F3FD]' : ''}
      >
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
              ? 'One file per tier, or one workbook with a tab per tier — tabs are matched to tiers by name.'
              : scope === 'clients'
                ? 'Columns for client name and tier are required.'
                : 'One row per SKU and location, with a quantity.'}
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
            const preview = extractRows(sheet.grid, plan.headerRow, plan.mapping).slice(0, 3);

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

                  {scope === 'prices' && (
                    <label className="text-[12px] flex items-center gap-1.5">
                      Tier
                      <select
                        className="w-[140px]" value={plan.tierId ?? ''}
                        onChange={(e) => updatePlan(sheet.name, { tierId: e.target.value || null })}
                      >
                        <option value="">Not imported</option>
                        {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  )}

                  <label className="text-[12px] flex items-center gap-1.5">
                    Header row
                    <input
                      type="number" min={1} className="num w-[70px]" value={plan.headerRow}
                      onChange={(e) => {
                        const headerRow = Math.max(1, Number(e.target.value) || 1);
                        const nextHeader = sheet.grid[headerRow - 1] ?? [];
                        updatePlan(sheet.name, {
                          headerRow,
                          mapping: guessMapping(nextHeader, FIELDS[scope].map((f) => f.key)),
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
                      {FIELDS[scope].map((field) => (
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

                    {preview.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-1">
                          First rows as mapped
                        </div>
                        <table>
                          <thead>
                            <tr>{FIELDS[scope].map((f) => <th key={f.key}>{f.label}</th>)}</tr>
                          </thead>
                          <tbody>
                            {preview.map((row, i) => (
                              <tr key={i}>
                                {FIELDS[scope].map((f) => (
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
                    onChange={(e) => { setEffectiveFrom(e.target.value); setPreviews(null); }}
                  />
                  <span className="block text-[11px] text-mute mt-1">
                    Upload next quarter early — prices switch over on this date on their own.
                  </span>
                </label>
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox" checked={deactivateMissing}
                    onChange={(e) => setDeactivateMissing(e.target.checked)}
                  />
                  Mark SKUs missing from the sheet inactive
                </label>
                <Button small kind="ghost" onClick={doPreview} disabled={pending}>
                  {pending ? 'Checking…' : 'Preview changes'}
                </Button>
                <Button small kind="cobalt" onClick={doApply} disabled={pending || !previews}>
                  Apply
                </Button>
              </>
            )}
            {scope !== 'prices' && (
              <Button small kind="cobalt" onClick={doApplyOther} disabled={pending || !included.length}>
                {pending ? 'Importing…' : `Import ${scope === 'clients' ? 'clients' : 'stock'}`}
              </Button>
            )}
          </Card>
        </>
      )}

      {previews?.map((p) => <PreviewCard key={p.tierId} preview={p} />)}
    </div>
  );
}

function PreviewCard({ preview }: { preview: PricePreview }) {
  const flagged = preview.changed.filter((c) => c.suspicious);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Tag tone="cobalt">{preview.tierName}</Tag>
        <span className="text-[12px]">
          <strong>{preview.created.length}</strong> new ·{' '}
          <strong>{preview.changed.length}</strong> changed ·{' '}
          <strong>{preview.unchanged}</strong> unchanged ·{' '}
          <strong>{preview.missing.length}</strong> not in this sheet
        </span>
        {flagged.length > 0 && <Tag tone="red">{flagged.length} to check</Tag>}
      </div>

      {preview.invalid.length > 0 && (
        <div className="mb-3">
          <Notice>
            {preview.invalid.length} row{preview.invalid.length === 1 ? '' : 's'} skipped:{' '}
            {preview.invalid.slice(0, 3).map((i) => `row ${i.row} (${i.reason})`).join(', ')}
            {preview.invalid.length > 3 ? '…' : ''}
          </Notice>
        </div>
      )}

      {preview.created.length > 0 && (
        <Bucket title={`New SKUs to be created (${preview.created.length})`}>
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Brand</th><th className="text-right">Price</th></tr></thead>
            <tbody>
              {preview.created.slice(0, 50).map((r) => (
                <tr key={r.sku}>
                  <td className="num font-semibold">{r.sku}</td>
                  <td>{r.name || '—'}</td>
                  <td className="text-mute">{r.brand || '—'}</td>
                  <td className="num text-right"><Money value={r.price} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bucket>
      )}

      {preview.changed.length > 0 && (
        <Bucket title={`Price changes (${preview.changed.length})`}>
          <table>
            <thead>
              <tr>
                <th>SKU</th><th>Product</th>
                <th className="text-right">Old</th><th className="text-right">New</th>
                <th className="text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {[...preview.changed]
                .sort((a, b) => Number(b.suspicious) - Number(a.suspicious))
                .slice(0, 100)
                .map((c) => (
                  <tr key={c.sku} className={c.suspicious ? 'bg-[#FDF2F0]' : ''}>
                    <td className="num font-semibold">{c.sku}</td>
                    <td>{c.name}</td>
                    <td className="num text-right text-mute"><Money value={c.oldPrice} /></td>
                    <td className="num text-right font-semibold"><Money value={c.newPrice} /></td>
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
      )}

      {preview.missing.length > 0 && (
        <Bucket title={`In the system but not in this sheet (${preview.missing.length})`}>
          <p className="text-[12px] text-mute mb-2">
            Reported only. Nothing is ever deleted by an import.
          </p>
          <p className="text-[12px] num">
            {preview.missing.slice(0, 40).map((m) => m.sku).join(' · ')}
            {preview.missing.length > 40 ? ` … and ${preview.missing.length - 40} more` : ''}
          </p>
        </Bucket>
      )}

      {preview.created.length === 0 && preview.changed.length === 0 && (
        <Empty>Nothing to change — every price in this sheet already matches.</Empty>
      )}
    </Card>
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
