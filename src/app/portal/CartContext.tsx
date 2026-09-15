'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

/**
 * The basket, held above the page tree and mirrored to localStorage.
 *
 * The catalogue is split across a collections page and one page per
 * collection, so the basket has to outlive navigation — and a trade order can
 * run to dozens of lines, which is not something to lose to a stray refresh or
 * a phone locking mid-order. Only quantities are kept; prices are always read
 * fresh from the server, so a stale basket can never carry a stale price.
 */
const STORAGE_KEY = 'iq-basket-v1';

type Quantities = Record<string, number>;

interface CartValue {
  quantities: Quantities;
  setQty: (productId: string, qty: number) => void;
  add: (productId: string, delta: number) => void;
  clear: () => void;
  totalItems: number;
  /** False until the stored basket has been read, so SSR and the first client
   *  render agree and React does not report a hydration mismatch. */
  ready: boolean;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [quantities, setQuantities] = useState<Quantities>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Quantities;
        // Trust nothing from storage: it may be older than the current code.
        const clean: Quantities = {};
        for (const [id, qty] of Object.entries(parsed)) {
          if (typeof id === 'string' && Number.isFinite(qty) && qty > 0) {
            clean[id] = Math.floor(qty);
          }
        }
        setQuantities(clean);
      }
    } catch {
      // Private browsing, cleared storage, or corrupt JSON — start empty.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(quantities));
    } catch {
      // Storage full or unavailable; the basket still works for this session.
    }
  }, [quantities, ready]);

  const setQty = useCallback((productId: string, qty: number) => {
    setQuantities((q) => {
      const next = { ...q };
      if (qty > 0) next[productId] = Math.floor(qty);
      else delete next[productId];
      return next;
    });
  }, []);

  const add = useCallback((productId: string, delta: number) => {
    setQuantities((q) => {
      const next = { ...q };
      const value = (q[productId] ?? 0) + delta;
      if (value > 0) next[productId] = value;
      else delete next[productId];
      return next;
    });
  }, []);

  const clear = useCallback(() => setQuantities({}), []);

  const totalItems = useMemo(
    () => Object.values(quantities).reduce((a, b) => a + b, 0),
    [quantities],
  );

  const value = useMemo(
    () => ({ quantities, setQty, add, clear, totalItems, ready }),
    [quantities, setQty, add, clear, totalItems, ready],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside a CartProvider');
  return ctx;
}
