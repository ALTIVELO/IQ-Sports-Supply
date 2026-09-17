'use client';

import { useMemo, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import ProductRow from '../../ProductRow';
import type { CatalogueItem } from '@/lib/types';

/** Filters within one collection. Large collections need it: bottom brackets
 *  alone runs to fifty-odd part codes. */
export default function CollectionSearch({ products }: { products: CatalogueItem[] }) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    return products
      .filter((p) => (s ? `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s) : true));
  }, [query, products]);

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
