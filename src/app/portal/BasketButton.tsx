'use client';

import Link from 'next/link';
import { useCart } from './CartContext';

/**
 * The basket, in the header, on every page of the portal.
 *
 * The count comes from localStorage, which the server cannot know, so nothing
 * is rendered until the stored basket has been read — a number that appears
 * and then corrects itself is worse than one that arrives a moment late.
 */
export default function BasketButton() {
  const { totalItems, ready } = useCart();

  return (
    <Link
      href="/portal/basket"
      className="relative flex items-center gap-2 rounded border border-white/15 bg-white/5
                 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10
                 transition-colors"
      aria-label={
        ready && totalItems > 0
          ? `Basket, ${totalItems} item${totalItems === 1 ? '' : 's'}`
          : 'Basket, empty'
      }
    >
      <BasketIcon />
      <span className="hidden sm:inline">Basket</span>
      {ready && totalItems > 0 && (
        <span
          className="num min-w-[18px] h-[18px] px-1 rounded-full bg-flame text-ink
                     text-[11px] font-bold flex items-center justify-center"
        >
          {totalItems > 99 ? '99+' : totalItems}
        </span>
      )}
    </Link>
  );
}

function BasketIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" aria-hidden>
      <path
        d="M3 6h14l-1.2 9.2a1.5 1.5 0 0 1-1.5 1.3H5.7a1.5 1.5 0 0 1-1.5-1.3L3 6Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      <path
        d="M7 6V4.8a3 3 0 0 1 6 0V6"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  );
}
