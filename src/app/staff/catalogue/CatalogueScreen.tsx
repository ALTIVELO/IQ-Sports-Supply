'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { fmtDate, today } from '@/lib/format';
import { saveProduct, setProductActive } from './actions';
import { setStock, createTransfer, receiveTransfer } from '../actions';

interface Product { id: string; sku: string; name: string; brand: string | null; active: boolean }
interface Named { id: string; name: string }
interface Transfer {
  id: string; number: string; date: string; status: string;
  from_location_id: string; to_location_id: string;
  stock_transfer_lines: { id: string; sku: string; name: string; qty: number }[];
}

type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

export default function CatalogueScreen({
  products, tiers, locations, prices, stock, transfers, query, tab,
}: {
  products: Product[]; tiers: Named[]; locations: Named[];
  prices: Record<string, Record<string, number>>;
  stock: Record<string, Record<string, number>>;
  transfers: Transfer[]; query: string; tab: 'catalogue' | 'transfers';
}) {
  const router = useRouter();
  const [message, setMessage] = useState<Msg>(null);

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
          <ProductEditor tiers={tiers} onMessage={setMessage} />
          <form className="flex gap-2">
            <input
              name="q" defaultValue={query} placeholder="Search SKU, name or brand…"
              className="max-w-[280px]"
            />
            <button className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch">
              Search
            </button>
          </form>
          <StockMatrix
            products={products} tiers={tiers} locations={locations}
            prices={prices} stock={stock} onMessage={setMessage}
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
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const r = await saveProduct({ sku, name, brand, prices, effectiveFrom });
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Saved' }
        : { tone: 'error', text: r.error ?? 'Could not save' });
      if (r.ok) { setSku(''); setName(''); setBrand(''); setPrices({}); setOpen(false); }
    });
  }

  if (!open) {
    return <Button small kind="ghost" onClick={() => setOpen(true)}>Add a product</Button>;
  }

  return (
    <Card accent className="space-y-3">
      <div className="grid sm:grid-cols-[140px_1fr_140px_150px] gap-2">
        <input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <input placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        <label className="text-[11px] text-mute">
          Prices effective from
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiers.length}, minmax(0,1fr))` }}>
        {tiers.map((t) => (
          <input
            key={t.id} type="number" step="0.01" min={0} className="num"
            placeholder={`${t.name} £`} value={prices[t.id] ?? ''}
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
  products, tiers, locations, prices, stock, onMessage,
}: {
  products: Product[]; tiers: Named[]; locations: Named[];
  prices: Record<string, Record<string, number>>;
  stock: Record<string, Record<string, number>>;
  onMessage: (m: Msg) => void;
}) {
  const [editing, setEditing] = useState<{ productId: string; locationId: string } | null>(null);
  const [value, setValue] = useState('0');
  const [pending, startTransition] = useTransition();

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

  if (!products.length) {
    return <Card><Empty>No products match. Add SKUs above, or bulk-load them on the Import screen.</Empty></Card>;
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Product</th><th>Brand</th>
              {locations.map((l) => <th key={l.id} className="text-right">{l.name}</th>)}
              <th className="text-right">Total</th>
              {tiers.map((t) => <th key={t.id} className="text-right">{t.name}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const byLoc = stock[p.id] ?? {};
              const total = Object.values(byLoc).reduce((a, b) => a + b, 0);
              return (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td className="num font-semibold">{p.sku}</td>
                  <td className="min-w-[200px]">{p.name}</td>
                  <td className="text-mute">{p.brand}</td>
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
                            className="hover:text-cobalt hover:underline"
                            onClick={() => { setEditing({ productId: p.id, locationId: l.id }); setValue(String(byLoc[l.id] ?? 0)); }}
                          >
                            {byLoc[l.id] ?? 0}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="num text-right font-semibold">{total}</td>
                  {tiers.map((t) => (
                    <td key={t.id} className="num text-right">
                      {prices[p.id]?.[t.id] != null ? <Money value={prices[p.id][t.id]} /> : '—'}
                    </td>
                  ))}
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
      <p className="text-[11px] text-mute mt-2">Click a stock figure to correct it.</p>
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
          <Button small kind="cobalt" onClick={submit} disabled={pending || !lines.length}>
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
                  small kind="cobalt" className="ml-auto" disabled={pending}
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
