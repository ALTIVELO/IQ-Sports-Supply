'use client';

import { useMemo, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import ProductRow from '../../ProductRow';
import type { CatalogueItem } from '../../page';

/** Filters within one collection. Large collections need it: bottom brackets
 *  alone runs to fifty-odd part codes. */
export default function CollectionSearch({ products }: { products: CatalogueItem[] }) {
  const [query, setQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    return products
      .filter((p) => (inStockOnly ? p.in_stock : true))
      .filter((p) => (s ? `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s) : true));
  }, [query, inStockOnly, products]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          placeholder="Search within this collection…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
          aria-label="Search within this collection"
        />
        <label className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
          <input
            type="checkbox" checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
          />
          In stock only
        </label>
        {results.length !== products.length && (
          <span className="text-[12px] text-mute num">
            {results.length} of {products.length}
          </span>
        )}
      </div>

      {results.length === 0 ? (
        <Card><Empty>Nothing here matches those filters.</Empty></Card>
      ) : (
        <div className="space-y-2">
          {results.map((p) => <ProductRow key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
