'use client';

import { useMemo, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import ProductRow from '../../ProductRow';
import { groupVariants } from '@/lib/catalogue/variants';
import type { CatalogueItem } from '@/lib/types';

/** Filters within one collection. Large collections need it: bottom brackets
 *  alone runs to fifty-odd part codes. */
export default function CollectionSearch({ products }: { products: CatalogueItem[] }) {
  const [query, setQuery] = useState('');

  // A bike is one result however many frame sizes it is built in, and a
  // search that matches one size brings the whole bike back with it.
  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return groupVariants(products);
    const hit = products
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s));
    const wanted = new Set(hit.map((p) => p.variant_group ?? p.id));
    return groupVariants(products.filter((p) => wanted.has(p.variant_group ?? p.id)));
  }, [query, products]);

  const total = useMemo(() => groupVariants(products).length, [products]);

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
        {results.length !== total && (
          <span className="text-[12px] text-mute num">
            {results.length} of {total}
          </span>
        )}
      </div>

      {results.length === 0 ? (
        <Card><Empty>Nothing here matches those filters.</Empty></Card>
      ) : (
        <div className="space-y-2">
          {results.map((g) => <ProductRow key={g.key} group={g} />)}
        </div>
      )}
    </div>
  );
}
