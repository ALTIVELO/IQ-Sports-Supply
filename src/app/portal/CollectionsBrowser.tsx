'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Empty } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import ProductRow from './ProductRow';
import BasketBar from './BasketBar';
import type { CatalogueItem } from './page';

/**
 * The catalogue's front door: one tile per collection, so a customer who knows
 * they want brake pads gets there in a click instead of scrolling a flat list.
 * Typing in the search box drops straight to matching products across every
 * collection, because someone who knows the SKU should not have to guess which
 * collection it is filed under.
 */
export default function CollectionsBrowser({
  products, vatRate,
}: { products: CatalogueItem[]; vatRate: number }) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const collections = useMemo(() => {
    const byslug = new Map<string, {
      slug: string; name: string; count: number; inStock: number; cover: string | null;
    }>();
    for (const p of products) {
      if (!p.category_slug || !p.category_name) continue;
      const entry = byslug.get(p.category_slug) ?? {
        slug: p.category_slug, name: p.category_name, count: 0, inStock: 0, cover: null,
      };
      entry.count += 1;
      if (p.in_stock) entry.inStock += 1;
      // First product with a photo represents the collection.
      if (!entry.cover && p.image_url) entry.cover = p.image_url;
      byslug.set(p.category_slug, entry);
    }
    return [...byslug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const unfiled = useMemo(() => products.filter((p) => !p.category_slug), [products]);

  const results = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return products
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(s))
      .slice(0, 120);
  }, [query, products]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Catalogue</h1>
        <p className="text-[13px] text-mute mt-1">
          {products.length} product{products.length === 1 ? '' : 's'} at your prices, excluding VAT.
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
      ) : collections.length === 0 && unfiled.length === 0 ? (
        <Card><Empty>The catalogue is empty.</Empty></Card>
      ) : (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2.5">
            Collections
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {collections.map((c) => (
              <CollectionTile
                key={c.slug} href={`/portal/c/${c.slug}`} name={c.name}
                count={c.count} inStock={c.inStock} cover={c.cover}
              />
            ))}
            {unfiled.length > 0 && (
              <CollectionTile
                href="/portal/c/other" name="Other"
                count={unfiled.length}
                inStock={unfiled.filter((p) => p.in_stock).length}
                cover={unfiled.find((p) => p.image_url)?.image_url ?? null}
              />
            )}
          </div>
        </section>
      )}

      <BasketBar products={products} vatRate={vatRate} />
    </div>
  );
}

function CollectionTile({
  href, name, count, inStock, cover,
}: {
  href: string; name: string; count: number; inStock: number; cover: string | null;
}) {
  return (
    <Link
      href={href}
      className="group block bg-white border border-line rounded-card overflow-hidden
                 hover:border-flame focus-visible:border-flame transition-colors"
    >
      <ProductImage
        src={cover}
        alt=""
        className="w-full aspect-[5/3] border-0 border-b border-line rounded-none bg-parch"
        sizePx={320}
        placeholderScale="quiet"
      />
      <div className="p-3">
        <div className="text-[13px] font-semibold leading-tight">{name}</div>
        <div className="text-[11px] text-mute mt-1 num">
          {count} item{count === 1 ? '' : 's'}
          {inStock > 0 && <span className="text-success"> · {inStock} in stock</span>}
        </div>
      </div>
    </Link>
  );
}
