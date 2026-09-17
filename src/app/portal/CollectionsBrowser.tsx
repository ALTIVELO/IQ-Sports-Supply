'use client';

import { useMemo, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import { buildTree, offeredLoose,
         type CategoryRow, type FiledGroup } from '@/lib/catalogue/tree';
import CollectionGrid from './CollectionGrid';
import ProductRow from './ProductRow';
import BasketBar from './BasketBar';
import type { CatalogueItem } from '@/lib/types';

/**
 * The catalogue's front door: the top-level groups — bikes, frames, parts,
 * clothing and so on — each opening onto the collections inside it.
 *
 * Typing in the search box drops straight to matching products across every
 * group, because someone who knows the SKU should not have to work out which
 * shelf it is on.
 */
export default function CollectionsBrowser({
  products, categories, configurators, vatRate,
}: {
  products: CatalogueItem[]; categories: CategoryRow[];
  configurators: FiledGroup[]; vatRate: number;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const groups = useMemo(
    () => buildTree(categories, products, configurators),
    [categories, products, configurators],
  );

  // Everything a customer can order on its own. A collection served by
  // builders keeps its products out of the listings and out of search, so a
  // fixed-spec groupset cannot be found round the back of the builder that
  // replaced it.
  const offered = useMemo(() => products.filter(offeredLoose), [products]);
  const unfiled = useMemo(() => offered.filter((p) => !p.category_slug), [offered]);

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return offered
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s))
      .slice(0, 120);
  }, [query, offered]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Catalogue</h1>
        <p className="text-[13px] text-mute mt-1">
          {offered.length} product{offered.length === 1 ? '' : 's'} at your prices, excluding VAT.
        </p>
      </div>

      <input
        placeholder="Search SKU, product or brand…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
        aria-label="Search the catalogue"
      />

      {searching ? (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </h2>
          {results.length === 0 ? (
            <Card><Empty>Nothing matches that search.</Empty></Card>
          ) : (
            <div className="space-y-2">
              {results.map((p) => <ProductRow key={p.id} product={p} />)}
            </div>
          )}
        </section>
      ) : groups.length === 0 && unfiled.length === 0 ? (
        <Card><Empty>The catalogue is empty.</Empty></Card>
      ) : (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2.5">
            Shop by department
          </h2>
          <CollectionGrid
            nodes={groups}
            extra={unfiled.length > 0 ? {
              slug: 'other',
              name: 'Other',
              total: unfiled.length,
              cover: unfiled.find((p) => p.image_url)?.image_url ?? null,
              childCount: 0,
            } : null}
          />
        </section>
      )}

      <BasketBar products={products} vatRate={vatRate} />
    </div>
  );
}
