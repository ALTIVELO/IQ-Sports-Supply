'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Notice } from '@/components/ui';
import { money } from '@/lib/format';
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
  const [placed, setPlaced] = useState<{ number: string; warning?: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const lines = useMemo(
    () => Object.entries(quantities)
      .map(([id, qty]) => ({ product: byId.get(id), qty }))
      .filter((l): l is { product: CatalogueItem; qty: number } => Boolean(l.product)),
    [quantities, byId],
  );

  const net = lines.reduce((a, l) => a + l.qty * Number(l.product.price), 0);
  const vat = (net * vatRate) / 100;

  function checkout() {
    setError('');
    startTransition(async () => {
      const r = await placeClientOrder(
        lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      );
      if (r.ok) {
        setPlaced({ number: r.orderNumber ?? '', warning: r.warning });
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
            <span className="text-[14px] font-semibold">Order {placed.number} placed</span>
            <span className="text-[12px] text-mute">
              Your invoice has been raised. Nothing is dispatched until payment reaches us.
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
            {totalItems === 1 ? '' : 's'} ·{' '}
            <span className="num">Net {money(net)}</span>
            {vatRate > 0 && <span className="num"> · VAT {money(vat)}</span>}
          </div>
          <div className="num text-[20px] font-semibold ml-auto">{money(net + vat)}</div>
          <Button kind="accent" onClick={checkout} disabled={pending}>
            {pending ? 'Placing…' : 'Place order'}
          </Button>
        </div>
      </div>
    </>
  );
}
