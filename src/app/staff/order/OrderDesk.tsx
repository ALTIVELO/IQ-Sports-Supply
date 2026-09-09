'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Money, Notice, Tag } from '@/components/ui';
import { placeOrder } from '../actions';
import type { DeskProduct } from './page';

interface ClientRow {
  id: string; name: string; tier_id: string; address: string | null;
  vat_exempt: boolean; default_location_id: string | null; email: string | null;
}
interface Named { id: string; name: string }

interface DraftLine {
  productId: string; sku: string; name: string; qty: number; unitPrice: number;
  /** The tier price, kept so an override is visible as an override. */
  tierPrice: number;
}

export default function OrderDesk({
  clients, locations, tiers, products, vatRate,
}: {
  clients: ClientRow[]; locations: Named[]; tiers: Named[];
  products: DeskProduct[]; vatRate: number;
}) {
  const [clientId, setClientId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [placed, setPlaced] = useState<{ id: string; warning?: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const client = clients.find((c) => c.id === clientId);
  const tier = tiers.find((t) => t.id === client?.tier_id);
  const location = locations.find((l) => l.id === locationId);

  function chooseClient(id: string) {
    setClientId(id);
    setLines([]);
    setPlaced(null);
    setError('');
    const c = clients.find((x) => x.id === id);
    setLocationId(c?.default_location_id ?? locations[0]?.id ?? '');
  }

  const priceFor = (p: DeskProduct) => (client ? p.prices[client.tier_id] ?? 0 : 0);
  const stockAt = (p: DeskProduct, loc: string) => p.stock[loc] ?? 0;
  const totalStock = (p: DeskProduct) => Object.values(p.stock).reduce((a, b) => a + b, 0);

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return products
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s))
      .slice(0, 8);
  }, [query, products]);

  function addLine(p: DeskProduct) {
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) {
        return ls.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      const price = priceFor(p);
      return [...ls, { productId: p.id, sku: p.sku, name: p.name, qty: 1, unitPrice: price, tierPrice: price }];
    });
    setQuery('');
  }

  const patch = (i: number, next: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...next } : l)));

  const net = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const effectiveVat = client?.vat_exempt ? 0 : vatRate;
  const vat = (net * effectiveVat) / 100;

  /** What this order will short at the chosen location, before it is placed. */
  const shortfall = lines
    .map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const available = stockAt(p, locationId);
      return { line: l, product: p, short: Math.max(0, l.qty - available), available };
    })
    .filter((r) => r.short > 0);

  function submit() {
    if (!client || !locationId || !lines.length) return;
    setError('');
    startTransition(async () => {
      const result = await placeOrder({
        clientId: client.id,
        locationId,
        lines: lines.map((l) => ({
          product_id: l.productId,
          qty: l.qty,
          // Only send a price when staff actually changed it.
          unit_price: l.unitPrice !== l.tierPrice ? l.unitPrice : null,
        })),
        notes: notes.trim() || undefined,
      });
      if (result.ok) {
        setPlaced({ id: result.orderId!, warning: result.warning });
        setLines([]);
        setNotes('');
      } else {
        setError(result.error ?? 'Could not place the order');
      }
    });
  }

  return (
    <div className="space-y-4">
      {placed && (
        <Card accent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px]">
              Order placed. The invoice has been raised and emailed to{' '}
              <strong>{client?.name}</strong>
              {' '}with the confirmation CC addresses copied in. Any shortfall has gone
              to the supplier carrying the order reference.
            </p>
            <Link
              href="/staff/orders"
              className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
            >
              View orders
            </Link>
          </div>
        </Card>
      )}

      {placed?.warning && <Notice tone="info">{placed.warning}</Notice>}
      {error && <Notice>{error}</Notice>}

      <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
        <Card className="space-y-3">
          <div>
            <div className="text-[12px] font-semibold mb-1.5">Client</div>
            <select value={clientId} onChange={(e) => chooseClient(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {client && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Tag tone="cobalt">{tier?.name} pricing</Tag>
                {client.vat_exempt && <Tag tone="line">Zero-rated / export</Tag>}
              </div>
              <p className="text-[12px] text-mute leading-relaxed">{client.address}</p>

              <div>
                <div className="text-[12px] font-semibold mb-1.5">Fulfil from</div>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-mute mt-1">
                  Allocation draws from this site only. The rest goes on back order.
                </p>
              </div>

              <div>
                <div className="text-[12px] font-semibold mb-1.5">Order note</div>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </>
          )}

          {clients.length === 0 && (
            <p className="text-[12px] text-mute">
              No clients yet — approve a trade account application, or add one under Clients.
            </p>
          )}
        </Card>

        <Card>
          <div className="text-[12px] font-semibold mb-1.5">Add products</div>
          <input
            placeholder={client ? 'Search SKU, name or brand…' : 'Choose a client first'}
            disabled={!client}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {results.length > 0 && (
            <div className="border border-line rounded mt-1.5 overflow-hidden">
              {results.map((p) => {
                const here = stockAt(p, locationId);
                const elsewhere = totalStock(p) - here;
                return (
                  <button
                    key={p.id}
                    onClick={() => addLine(p)}
                    className="flex w-full items-center gap-2.5 px-2.5 py-2 text-[13px] text-left border-b border-row-line last:border-b-0 hover:bg-parch"
                  >
                    <span className="num font-semibold min-w-[110px]">{p.sku}</span>
                    <span className="flex-1 min-w-0 truncate">{p.name}</span>
                    <span className={`num text-[12px] ${here > 0 ? 'text-success' : 'text-danger'}`}>
                      {here > 0 ? `${here} here` : 'back order'}
                    </span>
                    {elsewhere > 0 && (
                      <span className="num text-[12px] text-mute">{elsewhere} elsewhere</span>
                    )}
                    <span className="num font-semibold"><Money value={priceFor(p)} /></span>
                  </button>
                );
              })}
            </div>
          )}

          {lines.length > 0 && (
            <div className="overflow-x-auto mt-3.5">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Item</th>
                    <th className="w-[70px]">Qty</th>
                    <th className="w-[100px]">Unit</th>
                    <th className="w-[90px] text-right">Line</th>
                    <th className="w-[30px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId}>
                      <td className="num">{l.sku}</td>
                      <td>{l.name}</td>
                      <td>
                        <input
                          className="num" type="number" min={1} value={l.qty}
                          onChange={(e) => patch(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </td>
                      <td>
                        <input
                          className="num" type="number" step="0.01" min={0} value={l.unitPrice}
                          onChange={(e) => patch(i, { unitPrice: Number(e.target.value) || 0 })}
                        />
                        {l.unitPrice !== l.tierPrice && (
                          <span className="text-[10px] text-cobalt font-semibold">
                            override · tier <Money value={l.tierPrice} />
                          </span>
                        )}
                      </td>
                      <td className="num text-right"><Money value={l.qty * l.unitPrice} /></td>
                      <td>
                        <button
                          aria-label={`Remove ${l.sku}`}
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          className="text-mute text-[15px] leading-none hover:text-danger px-1"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {shortfall.length > 0 && (
            <div className="mt-3 border border-line rounded bg-parch px-3 py-2.5">
              <div className="text-[12px] font-semibold mb-1">
                Short at {location?.name} — these will back order
              </div>
              <ul className="text-[12px] text-mute space-y-0.5">
                {shortfall.map((r) => {
                  const others = locations
                    .filter((l) => l.id !== locationId && (r.product.stock[l.id] ?? 0) > 0)
                    .map((l) => `${l.name} ${r.product.stock[l.id]}`);
                  return (
                    <li key={r.line.productId} className="num">
                      {r.line.sku} — {r.short} short
                      {others.length > 0 && (
                        <span className="text-cobalt">
                          {' '}· in stock at {others.join(', ')} — switch site or raise a transfer
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {lines.length > 0 && (
            <div className="flex flex-wrap justify-end items-center gap-5 mt-3.5">
              <div className="num text-[13px] text-mute">
                Net <Money value={net} /> · VAT ({effectiveVat}%) <Money value={vat} />
              </div>
              <div className="num text-[24px] font-semibold tracking-[-0.02em]">
                <Money value={net + vat} />
              </div>
              <Button kind="cobalt" onClick={submit} disabled={pending || !locationId}>
                {pending ? 'Placing…' : 'Place order'}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
