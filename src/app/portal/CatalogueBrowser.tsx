'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { placeClientOrder } from './actions';

interface CatalogueItem {
  id: string; sku: string; name: string; brand: string | null;
  price: number; in_stock: boolean;
  category_slug: string | null; category_name: string | null;
}

function FilterChip({
  children, active, onClick,
}: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`text-[12px] font-semibold rounded-full px-3 py-1.5 border transition-colors
        ${active
          ? 'bg-ink text-white border-ink'
          : 'bg-white border-line text-ink hover:bg-parch'}`}
    >
      {children}
    </button>
  );
}

export default function CatalogueBrowser({
  products, vatRate,
}: { products: CatalogueItem[]; vatRate: number }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<string | null>(null);
  const [placedWarning, setPlacedWarning] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  /**
   * Only categories that actually have something in them, in the order the
   * catalogue defines, with a count. An empty filter is worse than no filter.
   */
  const categories = useMemo(() => {
    const counts = new Map<string, { slug: string; name: string; count: number }>();
    for (const p of products) {
      if (!p.category_slug || !p.category_name) continue;
      const entry = counts.get(p.category_slug)
        ?? { slug: p.category_slug, name: p.category_name, count: 0 };
      entry.count += 1;
      counts.set(p.category_slug, entry);
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const uncategorised = useMemo(
    () => products.filter((p) => !p.category_slug).length,
    [products],
  );

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    return products
      .filter((p) =>
        category === null ? true
        : category === '__none' ? !p.category_slug
        : p.category_slug === category)
      .filter((p) => (inStockOnly ? p.in_stock : true))
      .filter((p) => (s ? `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s) : true))
      .slice(0, 120);
  }, [query, category, inStockOnly, products]);

  const cartLines = Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ product: products.find((p) => p.id === id)!, qty }))
    .filter((l) => l.product);

  const net = cartLines.reduce((a, l) => a + l.qty * Number(l.product.price), 0);
  const vat = (net * vatRate) / 100;

  const add = (id: string, delta: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));

  function checkout() {
    setError('');
    startTransition(async () => {
      const r = await placeClientOrder(
        cartLines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      );
      if (r.ok) { setPlaced(r.orderNumber ?? ''); setPlacedWarning(r.warning); setCart({}); }
      else setError(r.error ?? 'Could not place your order');
    });
  }

  if (placed !== null) {
    return (
      <Card accent>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Order {placed} placed</h1>
        {placedWarning && (
          <div className="mt-3"><Notice tone="info">{placedWarning}</Notice></div>
        )}
        <p className="text-[13px] text-mute mt-2 leading-relaxed">
          Your invoice has been raised{placedWarning ? '' : ' and emailed to you'}. Anything we did not have on the
          shelf has gone straight to our supplier — you will see an expected date on your
          back order list as soon as we have one. Nothing is dispatched until payment
          reaches us.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link
            href="/portal/orders"
            className="text-[13px] font-semibold bg-cobalt text-white rounded px-4 py-2"
          >
            Track this order
          </Link>
          <button
            onClick={() => setPlaced(null)}
            className="text-[13px] font-semibold border border-line bg-white rounded px-4 py-2"
          >
            Keep shopping
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Catalogue</h1>
        <p className="text-[13px] text-mute mt-1">
          Your prices, shown excluding VAT.
        </p>
      </div>

      {error && <Notice>{error}</Notice>}

      <input
        placeholder="Search SKU, product or brand…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
      />

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          <FilterChip active={category === null} onClick={() => setCategory(null)}>
            All <span className="opacity-60">{products.length}</span>
          </FilterChip>
          {categories.map((c) => (
            <FilterChip
              key={c.slug}
              active={category === c.slug}
              onClick={() => setCategory(category === c.slug ? null : c.slug)}
            >
              {c.name} <span className="opacity-60">{c.count}</span>
            </FilterChip>
          ))}
          {uncategorised > 0 && (
            <FilterChip
              active={category === '__none'}
              onClick={() => setCategory(category === '__none' ? null : '__none')}
            >
              Other <span className="opacity-60">{uncategorised}</span>
            </FilterChip>
          )}
          <FilterChip active={inStockOnly} onClick={() => setInStockOnly(!inStockOnly)}>
            In stock only
          </FilterChip>
        </div>
      )}

      {results.length === 0 ? (
        <Card><Empty>Nothing matches those filters.</Empty></Card>
      ) : (
        <div className="space-y-2">
          {results.map((p) => (
            <Card key={p.id} className="!p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="num text-[12px] font-semibold text-mute">{p.sku}</div>
                  <div className="text-[13px] font-medium">{p.name}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {p.brand && <span className="text-[11px] text-mute">{p.brand}</span>}
                    {p.category_name && <Tag tone="line">{p.category_name}</Tag>}
                    {p.in_stock
                      ? <Tag tone="green">In stock</Tag>
                      : <Tag tone="line">Back order</Tag>}
                  </div>
                </div>

                <div className="num text-[15px] font-semibold w-[90px] text-right">
                  <Money value={Number(p.price)} />
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => add(p.id, -1)}
                    disabled={!cart[p.id]}
                    aria-label={`Remove one ${p.sku}`}
                    className="w-9 h-9 border border-line rounded bg-white text-[16px] disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="num w-9 text-center text-[14px] font-semibold">
                    {cart[p.id] ?? 0}
                  </span>
                  <button
                    onClick={() => add(p.id, 1)}
                    aria-label={`Add one ${p.sku}`}
                    className="w-9 h-9 border border-line rounded bg-white text-[16px] hover:bg-parch"
                  >
                    +
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {cartLines.length > 0 && (
        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white border-t border-line shadow-[0_-4px_16px_rgba(22,34,46,0.08)]">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
            <div className="text-[12px] text-mute">
              {cartLines.reduce((a, l) => a + l.qty, 0)} items ·{' '}
              <span className="num">Net <Money value={net} /></span>
              {vatRate > 0 && <span className="num"> · VAT <Money value={vat} /></span>}
            </div>
            <div className="num text-[20px] font-semibold ml-auto">
              <Money value={net + vat} />
            </div>
            <Button kind="cobalt" onClick={checkout} disabled={pending}>
              {pending ? 'Placing…' : 'Place order'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
