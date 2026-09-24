'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { currencyOf, money } from '@/lib/format';
import { totalsByCurrency } from '@/lib/orders/split';
import { useCart } from './CartContext';
import type { CatalogueItem } from '@/lib/types';

/**
 * The sticky basket. Rendered on every catalogue page, so the running total
 * follows the customer as they move between collections.
 *
 * It is given the full product list rather than just what is on screen — the
 * basket can hold things from collections the customer has since navigated
 * away from, and those still have to be priced and counted.
 *
 * It counts and totals; it does not place anything. It used to: a single
 * orange "Place order" pinned to the bottom of a catalogue page raised a real
 * order and a real invoice, one tap away from the plus buttons somebody was
 * still nudging, and it skipped the basket screen where the delivery address
 * and the dropship terms are agreed. Ordering belongs on the screen that shows
 * the whole order, so this leads there instead.
 */
export default function BasketBar({
  products, vatRate,
}: { products: CatalogueItem[]; vatRate: number }) {
  const { quantities, totalItems, ready } = useCart();

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

  // Nothing to show before the stored basket has loaded, or when it is empty.
  if (!ready || lines.length === 0) return null;

  return (
    <>
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
          {/* A link, not a button that does something. What it leads to is the
              basket, where the whole order is visible and where placing it
              asks for everything placing it needs. */}
          <Link
            href="/portal/basket"
            className="text-[13px] font-semibold bg-flame text-white rounded
                       px-4 py-2.5 hover:bg-flame/90 whitespace-nowrap"
          >
            Review the basket
          </Link>
        </div>
      </div>
    </>
  );
}
