'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { CURRENCY_SYMBOL, currencyOf, fmtDate, money, today } from '@/lib/format';
import { saveProduct, setProductActive, deleteProducts, ungroupProducts } from './actions';
import { setStock, createTransfer, receiveTransfer } from '../actions';
import { categoriseUncategorised, setProductCategory } from '../import/actions';
import ImageCell from './ImageCell';
import GroupVariants from './GroupVariants';
import { groupSizes, groupName } from '@/lib/catalogue/variants';
import CollectionPicker, { collectionName } from '@/components/CollectionPicker';
import { catalogueHref, type CollectionGroup } from '@/lib/catalogue/collections';

interface Product {
  id: string; sku: string; name: string; brand: string | null;
  active: boolean; category_id: string | null; image_url: string | null;
  /** The money this product's cost and every tier price are quoted in. */
  currency: string;
  /** Its size, where it is one size of a model: a frame, a crank, a ratio. */
  variant_label: string | null;
  /** Shared by every size of one model. */
  variant_group: string | null;
  variant_sort: number | null;
}
interface Named { id: string; name: string }
interface CategoryOption {
  id: string; name: string; slug: string; sort: number; parent_id: string | null;
}
interface Transfer {
  id: string; number: string; date: string; status: string;
  from_location_id: string; to_location_id: string;
  stock_transfer_lines: { id: string; sku: string; name: string; qty: number }[];
}

type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

export default function CatalogueScreen({
  products, tiers, locations, prices, costs, stock, transfers, categories,
  collections, uncategorisedTotal, collection, canDelete, query, tab,
}: {
  products: Product[]; tiers: Named[]; locations: Named[];
  prices: Record<string, Record<string, number>>;
  /** Product id → what it costs us today. Staff-only, and never sent client-side. */
  costs: Record<string, number>;
  stock: Record<string, Record<string, number>>;
  transfers: Transfer[]; categories: CategoryOption[];
  collections: CollectionGroup[];
  uncategorisedTotal: number;
  /** The collection being shown, 'none' for the unfiled, or null for all of it. */
  collection: string | null;
  canDelete: boolean; query: string; tab: 'catalogue' | 'transfers';
}) {
  const router = useRouter();
  const [message, setMessage] = useState<Msg>(null);

  // Both filters live in the URL, so a collection survives a reload and can be
  // sent to somebody — and so the query that fetches 500 rows is the one doing
  // the filtering, rather than 500 arbitrary rows being filtered on screen.
  const go = (next: { collection?: string | null; q?: string }) =>
    router.push(catalogueHref({ collection, q: query }, next));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['catalogue', 'transfers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => router.push(t === 'catalogue' ? '/staff/catalogue' : '/staff/catalogue?tab=transfers')}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border capitalize
              ${tab === t ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-parch'}`}
          >
            {t === 'catalogue' ? 'Catalogue & stock' : 'Stock transfers'}
          </button>
        ))}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {tab === 'catalogue' ? (
        <>
          <div className="flex flex-wrap items-start gap-2">
            <ProductEditor tiers={tiers} onMessage={setMessage} />
            <GroupVariants onMessage={setMessage} />
          </div>

          <CollectionPicker
            groups={collections}
            uncategorised={uncategorisedTotal}
            value={collection}
            onChange={(slug) => go({ collection: slug })}
          />

          <form className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  go({ q: new FormData(e.currentTarget).get('q') as string });
                }}>
            <input
              name="q" defaultValue={query} placeholder="Search SKU, name or brand…"
              className="max-w-[280px]"
            />
            <button className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch">
              Search
            </button>
            {/* Says what is on screen, because a collection chosen two scrolls
                up is otherwise invisible from down among the rows. */}
            {(collection || query) && (
              <span className="text-[12px] text-mute">
                {products.length === 500 ? 'First 500 of ' : `${products.length} `}
                SKU{products.length === 1 ? '' : 's'}
                {collection && <> in <strong className="text-ink">
                  {collectionName(categories, collection)}</strong></>}
                {query && <> matching &ldquo;{query}&rdquo;</>}
                {' · '}
                <button type="button" onClick={() => go({ collection: null, q: '' })}
                        className="underline hover:text-ink">
                  show everything
                </button>
              </span>
            )}
          </form>
          <StockMatrix
            products={products} tiers={tiers} locations={locations}
            prices={prices} costs={costs} stock={stock} categories={categories}
            canDelete={canDelete} onMessage={setMessage}
          />
        </>
      ) : (
        <Transfers
          products={products} locations={locations} stock={stock}
          transfers={transfers} onMessage={setMessage}
        />
      )}
    </div>
  );
}

function ProductEditor({ tiers, onMessage }: { tiers: Named[]; onMessage: (m: Msg) => void }) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const r = await saveProduct({ sku, name, brand, prices, cost, effectiveFrom, currency });
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Saved' }
        : { tone: 'error', text: r.error ?? 'Could not save' });
      if (r.ok) {
        setSku(''); setName(''); setBrand(''); setPrices({}); setCost('');
        setCurrency('GBP'); setOpen(false);
      }
    });
  }

  if (!open) {
    return <Button small kind="ghost" onClick={() => setOpen(true)}>Add a product</Button>;
  }

  return (
    // w-full so that, sharing a wrapping row with the other button, an open
    // panel takes a line of its own rather than being squeezed beside it.
    <Card accent className="space-y-3 w-full">
      <div className="grid sm:grid-cols-[140px_1fr_140px_90px_150px] gap-2">
        <input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <input placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        {/* Every figure below is in this, cost and tiers alike. Nothing is
            converted anywhere — the currency travels with the price. */}
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                aria-label="Currency">
          <option value="GBP">£ GBP</option>
          <option value="EUR">€ EUR</option>
        </select>
        <label className="text-[11px] text-mute">
          Prices effective from
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-2"
           style={{ gridTemplateColumns: `repeat(${tiers.length + 1}, minmax(0,1fr))` }}>
        <input
          type="number" step="0.01" min={0} className="num"
          placeholder={`Our cost ${CURRENCY_SYMBOL[currencyOf(currency)]}`} value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        {tiers.map((t) => (
          <input
            key={t.id} type="number" step="0.01" min={0} className="num"
            placeholder={`${t.name} ${CURRENCY_SYMBOL[currencyOf(currency)]}`}
            value={prices[t.id] ?? ''}
            onChange={(e) => setPrices((p) => ({ ...p, [t.id]: e.target.value }))}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button small onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Add product'}</Button>
        <Button small kind="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}

function StockMatrix({
  products, tiers, locations, prices, costs, stock, categories, canDelete, onMessage,
}: {
  products: Product[]; tiers: Named[]; locations: Named[];
  prices: Record<string, Record<string, number>>;
  costs: Record<string, number>;
  stock: Record<string, Record<string, number>>;
  categories: CategoryOption[];
  canDelete: boolean;
  onMessage: (m: Msg) => void;
}) {
  const [editing, setEditing] = useState<{ productId: string; locationId: string } | null>(null);
  const [value, setValue] = useState('0');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectAllRef = useRef<HTMLInputElement>(null);

  const visibleIds = useMemo(() => products.map((p) => p.id), [products]);
  // A selection is only meaningful for rows still on screen: searching, or a
  // delete, can take a chosen row away, and deleting something the person can
  // no longer see is exactly the surprise to avoid.
  const chosen = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );
  const allShown = chosen.length > 0 && chosen.length === visibleIds.length;
  const grouped = useMemo(
    () => chosen.filter((id) => products.find((p) => p.id === id)?.variant_group),
    [chosen, products],
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = chosen.length > 0 && !allShown;
    }
  }, [chosen.length, allShown]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function toggleAll() {
    setSelected(allShown ? new Set() : new Set(visibleIds));
    setConfirming(false);
  }

  function removeChosen() {
    startTransition(async () => {
      const r = await deleteProducts(chosen);
      onMessage(r.ok
        ? { tone: r.withdrawn?.length ? 'info' : 'success', text: r.message ?? 'Done' }
        : { tone: 'error', text: r.error ?? 'Could not delete those products' });
      if (r.ok) { setSelected(new Set()); setConfirming(false); }
    });
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await setStock({
        productId: editing.productId,
        locationId: editing.locationId,
        qty: Number(value) || 0,
      });
      onMessage(r.ok
        ? { tone: 'success', text: 'Stock updated' }
        : { tone: 'error', text: r.error ?? 'Could not update stock' });
      setEditing(null);
    });
  }

  const uncategorised = products.filter((p) => !p.category_id).length;

  /**
   * The table's rows, with a model's sizes gathered under a heading.
   *
   * Gathered rather than collapsed. Every size keeps its own row because every
   * size has its own stock to set, its own cost and its own price per tier —
   * hiding four of five chainsets behind a chevron would put the thing this
   * screen exists to edit one click further away. The heading only says which
   * of them belong together, which is what was missing.
   */
  const rows = useMemo(() => {
    const out: ({ kind: 'head'; key: string; name: string; count: number }
              | { kind: 'row'; key: string; product: Product })[] = [];
    for (const shelf of groupSizes(products)) {
      if (shelf.sizes.length > 1) {
        out.push({
          kind: 'head', key: `h-${shelf.key}`,
          name: groupName(shelf), count: shelf.sizes.length,
        });
      }
      for (const product of shelf.sizes) {
        out.push({ kind: 'row', key: product.id, product });
      }
    }
    return out;
  }, [products]);

  // Categories are a two-level tree now, so the picker mirrors it — seventy
  // options in one flat list is not a choice anyone can make quickly.
  const groupedCategories = categories
    .filter((c) => c.parent_id === null)
    .sort((a, b) => a.sort - b.sort)
    .map((group) => ({
      group,
      children: categories
        .filter((c) => c.parent_id === group.id)
        .sort((a, b) => a.sort - b.sort),
    }));

  if (!products.length) {
    return (
      <Card>
        <Empty>
          Nothing here. Pick another collection above, add a SKU, or bulk-load
          them on the Import screen.
        </Empty>
      </Card>
    );
  }

  return (
    <Card>
      {uncategorised > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-line">
          <span className="text-[12px] text-mute">
            {uncategorised} product{uncategorised === 1 ? ' has' : 's have'} no category, so
            {uncategorised === 1 ? ' it does' : ' they do'} not appear under any customer filter.
          </span>
          <Button
            small kind="accent" disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await categoriseUncategorised();
                onMessage(r.ok
                  ? { tone: 'success', text: r.message ?? 'Categorised' }
                  : { tone: 'error', text: r.error ?? 'Failed' });
              })
            }
          >
            Categorise from descriptions
          </Button>
        </div>
      )}
      {canDelete && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-line">
          <span className="text-[13px] font-semibold">
            {chosen.length} selected
          </span>
          <button onClick={() => { setSelected(new Set()); setConfirming(false); }}
                  className="text-[12px] text-mute hover:text-ink underline">
            Clear
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* The way back from a wrong grouping, offered exactly where the
                wrong grouping is visible. Ungrouping one of a pair leaves the
                other on its own, which the catalogue draws as an ordinary
                product, so there is nothing to tidy up afterwards. */}
            {grouped.length > 0 && !confirming && (
              <Button
                small kind="ghost" disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await ungroupProducts(grouped);
                    onMessage(r.ok
                      ? { tone: 'success', text: r.message ?? 'Ungrouped' }
                      : { tone: 'error', text: r.error ?? 'Failed' });
                    if (r.ok) setSelected(new Set());
                  })
                }
              >
                Ungroup {grouped.length}
              </Button>
            )}
            {confirming ? (
              <>
                <span className="text-[12px]">
                  Delete {chosen.length} product{chosen.length === 1 ? '' : 's'}? Any that
                  appear on a past order are withdrawn instead, not destroyed.
                </span>
                <Button small kind="danger" disabled={pending} onClick={removeChosen}>
                  {pending ? 'Deleting…' : 'Yes, delete'}
                </Button>
                <Button small kind="ghost" disabled={pending}
                        onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button small kind="danger" disabled={pending}
                      onClick={() => { setConfirming(true); onMessage(null); }}>
                Delete selected
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {canDelete && (
                <th className="w-[34px]">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allShown}
                    onChange={toggleAll}
                    aria-label="Select every product shown"
                  />
                </th>
              )}
              <th className="w-[60px]">Image</th>
              <th>SKU</th><th>Product</th><th>Brand</th><th>Category</th>
              {locations.map((l) => <th key={l.id} className="text-right">{l.name}</th>)}
              <th className="text-right">Total</th>
              <th className="text-right">Cost</th>
              {tiers.map((t) => <th key={t.id} className="text-right">{t.name}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              if (entry.kind === 'head') {
                return (
                  <tr key={entry.key} className="bg-parch">
                    <td colSpan={99} className="!py-1.5">
                      <span className="text-[12px] font-semibold">{entry.name}</span>
                      <span className="text-[11px] text-mute num"> · {entry.count} sizes</span>
                    </td>
                  </tr>
                );
              }
              const p = entry.product;
              const byLoc = stock[p.id] ?? {};
              const total = Object.values(byLoc).reduce((a, b) => a + b, 0);
              return (
                <tr key={p.id}
                    className={`${p.active ? '' : 'opacity-50'} ${selected.has(p.id) ? 'bg-parch' : ''}`}>
                  {canDelete && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        aria-label={`Select ${p.sku}`}
                      />
                    </td>
                  )}
                  <td>
                    <ImageCell
                      productId={p.id} sku={p.sku} imageUrl={p.image_url}
                      onMessage={onMessage}
                    />
                  </td>
                  <td className="num font-semibold whitespace-nowrap">{p.sku}</td>
                  {/* Under a heading that already names the model, the row
                      only has to say which one it is — repeating "C/SET D/Ace
                      R9200" on all six of them, each ending in the size that
                      is also in the chip beside it, is three ways of saying
                      the same thing. The full description stays on hover. */}
                  <td className="min-w-[200px]" title={p.name}>
                    {p.variant_label ? (
                      <span className="text-[11px] font-semibold border border-line
                                       rounded px-[6px] py-[2px] whitespace-nowrap">
                        {p.variant_label}
                      </span>
                    ) : p.name}
                  </td>
                  <td className="text-mute">{p.brand}</td>
                  <td>
                    <select
                      className="text-[12px] min-w-[150px]"
                      value={p.category_id ?? ''}
                      onChange={(e) =>
                        startTransition(async () => {
                          const r = await setProductCategory(p.id, e.target.value || null);
                          if (!r.ok) onMessage({ tone: 'error', text: r.error ?? 'Failed' });
                        })
                      }
                    >
                      <option value="">— none —</option>
                      {groupedCategories.map(({ group, children }) => (
                        <optgroup key={group.id} label={group.name}>
                          <option value={group.id}>{group.name} (whole department)</option>
                          {children.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  {locations.map((l) => {
                    const isEditing = editing?.productId === p.id && editing.locationId === l.id;
                    return (
                      <td key={l.id} className="num text-right">
                        {isEditing ? (
                          <input
                            autoFocus type="number" min={0} value={value} className="num w-[70px]"
                            onChange={(e) => setValue(e.target.value)}
                            onBlur={save}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') save();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            disabled={pending}
                          />
                        ) : (
                          <button
                            className="hover:text-flame-text hover:underline"
                            onClick={() => { setEditing({ productId: p.id, locationId: l.id }); setValue(String(byLoc[l.id] ?? 0)); }}
                          >
                            {byLoc[l.id] ?? 0}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="num text-right font-semibold">{total}</td>
                  <td className="num text-right text-mute">
                    {costs[p.id] != null
                      ? <Money value={costs[p.id]} currency={p.currency} /> : '—'}
                  </td>
                  {tiers.map((t) => {
                    const price = prices[p.id]?.[t.id];
                    const cost = costs[p.id];
                    // A tier priced at or under what we pay sells at a loss.
                    // Worth seeing at a glance, not only on the import preview.
                    const atALoss = price != null && cost != null && price <= cost;
                    return (
                      <td
                        key={t.id}
                        className={`num text-right ${atALoss ? 'text-danger font-semibold' : ''}`}
                        title={atALoss
                          ? `At or below the ${money(cost, p.currency)} we pay` : undefined}
                      >
                        {price != null ? <Money value={price} currency={p.currency} /> : '—'}
                      </td>
                    );
                  })}
                  <td className="text-right">
                    <Button
                      small kind="ghost"
                      onClick={() =>
                        startTransition(async () => {
                          const r = await setProductActive(p.id, !p.active);
                          if (!r.ok) onMessage({ tone: 'error', text: r.error ?? 'Failed' });
                        })
                      }
                    >
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-mute mt-2">
        Click a stock figure to correct it, or a thumbnail to set the product image.
        {canDelete && ' Tick the boxes to remove several products at once — anything that has '
          + 'been sold is withdrawn from the catalogue rather than deleted, so past invoices '
          + 'still read correctly.'}
      </p>
    </Card>
  );
}

function Transfers({
  products, locations, stock, transfers, onMessage,
}: {
  products: Product[]; locations: Named[];
  stock: Record<string, Record<string, number>>;
  transfers: Transfer[]; onMessage: (m: Msg) => void;
}) {
  const [from, setFrom] = useState(locations[0]?.id ?? '');
  const [to, setTo] = useState(locations[1]?.id ?? '');
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>([]);
  const [pending, startTransition] = useTransition();

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? '—';

  function submit() {
    startTransition(async () => {
      const r = await createTransfer({ fromLocationId: from, toLocationId: to, lines });
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Transfer raised' }
        : { tone: 'error', text: r.error ?? 'Could not raise the transfer' });
      if (r.ok) setLines([]);
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="text-[12px] font-semibold">Move stock between sites</div>
        <div className="grid sm:grid-cols-2 gap-2 max-w-md">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>

        {lines.map((l, i) => (
          <div key={i} className="grid sm:grid-cols-[1fr_100px_auto] gap-2">
            <select
              value={l.product_id}
              onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name} ({stock[p.id]?.[from] ?? 0} at {locName(from)})
                </option>
              ))}
            </select>
            <input
              type="number" min={1} className="num" value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) || 0 } : x))}
            />
            <Button small kind="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Button small kind="ghost" onClick={() => setLines((ls) => [...ls, { product_id: '', qty: 1 }])}>
            Add line
          </Button>
          <Button small kind="accent" onClick={submit} disabled={pending || !lines.length}>
            {pending ? 'Raising…' : 'Raise transfer'}
          </Button>
        </div>
      </Card>

      {transfers.length === 0 ? (
        <Card><Empty>No transfers yet.</Empty></Card>
      ) : (
        transfers.map((t) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="num font-bold">{t.number}</span>
              <span className="text-[13px]">{locName(t.from_location_id)} → {locName(t.to_location_id)}</span>
              <span className="text-[12px] text-mute num">{fmtDate(t.date)}</span>
              <Tag tone={t.status === 'received' ? 'green' : 'line'}>{t.status.replace('_', ' ')}</Tag>
              <span className="text-[12px] text-mute">
                {t.stock_transfer_lines.reduce((a, l) => a + l.qty, 0)} units
              </span>
              {t.status !== 'received' && (
                <Button
                  small kind="accent" className="ml-auto" disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await receiveTransfer(t.id);
                      onMessage(r.ok
                        ? { tone: 'success', text: r.message ?? 'Received' }
                        : { tone: 'error', text: r.error ?? 'Could not receive' });
                    })
                  }
                >
                  Receive at {locName(t.to_location_id)}
                </Button>
              )}
            </div>
            <div className="text-[12px] text-mute num mt-2">
              {t.stock_transfer_lines.map((l) => `${l.sku} ×${l.qty}`).join(' · ')}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
