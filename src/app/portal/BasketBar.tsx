'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Notice } from '@/components/ui';
import { currencyOf, money } from '@/lib/format';
import { totalsByCurrency } from '@/lib/orders/split';
import { useCart } from './CartContext';
import { placeClientOrder } from './actions';
import type { CatalogueItem } from '@/lib/types';

/**
 * The sticky basket. Rendered on every catalogue page, so the running total
 * follows the customer as they move between collections.
 *
 * It is given the full product list rather than just what is on screen — the
 * basket can hold things from collections the customer has since navigated
 * away from, and those still have to be priced and counted.
 */
export default function BasketBar({
  products, vatRate,
}: { products: CatalogueItem[]; vatRate: number }) {
  const { quantities, clear, totalItems, ready } = useCart();
  const [placed, setPlaced] = useState<
    { orders: { number: string; currency: string }[]; warning?: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const lines = useMemo(
    () => Object.entries(quantities)
      .map(([id, qty]) => ({ product: byId.get(id), qty }))
      .filter((l): l is { product: CatalogueItem; qty: number } => Boolean(l.product)),
    [quantities, byId],
  );

  // Per currency, because a basket holding both is raised as two orders with
  // two invoices, and one added-up figure would be a number nobody is billed.
  const totals = useMemo(
    () => totalsByCurrency(
      lines,
      (l) => currencyOf(l.product.currency),
      (l) => l.qty * Number(l.product.price),
      vatRate,
    ),
    [lines, vatRate],
  );

  function checkout() {
    setError('');
    startTransition(async () => {
      const r = await placeClientOrder(
        lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      );
      if (r.ok) {
        setPlaced({ orders: r.orders ?? [], warning: r.warning });
        clear();
      } else {
        setError(r.error ?? 'Could not place your order');
      }
    });
  }

  if (placed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-20 bg-white border-t border-flame shadow-[0_-4px_16px_rgba(18,22,25,0.10)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[14px] font-semibold">
              {placed.orders.length > 1 ? 'Orders ' : 'Order '}
              {placed.orders.map((o) => o.number).join(' and ')} placed
            </span>
            <span className="text-[12px] text-mute">
              {placed.orders.length > 1
                ? `One per currency, ${placed.orders.length} invoices raised. `
                : 'Your invoice has been raised. '}
              Nothing is dispatched until payment reaches us.
            </span>
            <div className="ml-auto flex gap-2">
              <Link
                href="/portal/orders"
                className="text-[12px] font-semibold bg-ink text-white rounded px-[10px] py-[5px]"
              >
                Track it
              </Link>
              <Button small kind="ghost" onClick={() => setPlaced(null)}>Keep shopping</Button>
            </div>
          </div>
          {placed.warning && <div className="mt-2"><Notice tone="info">{placed.warning}</Notice></div>}
        </div>
      </div>
    );
  }

  // Nothing to show before the stored basket has loaded, or when it is empty.
  if (!ready || lines.length === 0) {
    return error ? <Notice>{error}</Notice> : null;
  }

  return (
    <>
      {error && <Notice>{error}</Notice>}
      <div className="h-20" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-20 bg-white border-t border-line shadow-[0_-4px_16px_rgba(18,22,25,0.08)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="text-[12px] text-mute">
            <span className="num font-semibold text-ink">{totalItems}</span> item
            {totalItems === 1 ? '' : 's'}
            {totals.length > 1 && <> · {totals.length} orders, one per currency</>}
          </div>
          <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {totals.map((t) => (
              <span key={t.currency} className="num text-[20px] font-semibold">
                {money(t.net + t.vat, t.currency)}
              </span>
            ))}
          </div>
          <Button kind="accent" onClick={checkout} disabled={pending}>
            {pending
              ? 'Placing…'
              : totals.length > 1 ? `Place ${totals.length} orders` : 'Place order'}
          </Button>
        </div>
      </div>
    </>
  );
}
