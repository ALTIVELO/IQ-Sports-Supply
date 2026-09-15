'use client';

import Link from 'next/link';
import ProductImage from '@/components/ProductImage';
import type { Node } from '@/lib/catalogue/tree';

interface Tile {
  slug: string; name: string; total: number; inStock: number;
  cover: string | null; childCount: number;
}

/** The tile grid, used for groups on the landing page and for the collections
 *  inside a group. */
export default function CollectionGrid({
  nodes, extra = null,
}: { nodes: Node[]; extra?: Tile | null }) {
  const tiles: Tile[] = [
    ...nodes.map((n) => ({
      slug: n.slug, name: n.name, total: n.total, inStock: n.inStock,
      cover: n.cover, childCount: n.children.length,
    })),
    ...(extra ? [extra] : []),
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <Link
          key={t.slug}
          href={`/portal/c/${t.slug}`}
          className={`group block bg-white border rounded-card overflow-hidden
                      hover:border-flame focus-visible:border-flame transition-colors
                      ${t.total === 0 ? 'border-line/70' : 'border-line'}`}
        >
          <ProductImage
            src={t.cover}
            alt=""
            className={`w-full aspect-[5/3] border-0 border-b border-line rounded-none bg-parch
                        ${t.total === 0 ? 'opacity-60' : ''}`}
            sizePx={320}
            placeholderScale="quiet"
          />
          <div className="p-3">
            <div className={`text-[13px] font-semibold leading-tight
                             ${t.total === 0 ? 'text-mute' : ''}`}>
              {t.name}
            </div>
            <div className="text-[11px] text-mute mt-1 num">
              {t.total === 0 ? (
                /* Shown rather than hidden, so the range is visible before the
                   shelves are full — but marked, so nobody expects stock. */
                <span>Coming soon</span>
              ) : (
                <>
                  {t.childCount > 0 && (
                    <>{t.childCount} collection{t.childCount === 1 ? '' : 's'} · </>
                  )}
                  {t.total} item{t.total === 1 ? '' : 's'}
                  {t.inStock > 0 && <span className="text-success"> · {t.inStock} in stock</span>}
                </>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
