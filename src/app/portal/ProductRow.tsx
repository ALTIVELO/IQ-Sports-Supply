'use client';

import { Card, Money, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import { useCart } from './CartContext';
import type { CatalogueItem } from '@/lib/types';

/** One catalogue line: photo, identity, price, and the quantity stepper. */
export default function ProductRow({ product }: { product: CatalogueItem }) {
  const { quantities, add } = useCart();
  const qty = quantities[product.id] ?? 0;

  return (
    <Card className={`!p-3 ${qty > 0 ? 'border-flame' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="w-14 h-14 flex-shrink-0"
          sizePx={112}
        />

        <div className="min-w-0 flex-1">
          <div className="num text-[12px] font-semibold text-mute">{product.sku}</div>
          <div className="text-[13px] font-medium">{product.name}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {product.brand && <span className="text-[11px] text-mute">{product.brand}</span>}
            {product.category_name && <Tag tone="line">{product.category_name}</Tag>}
          </div>
        </div>

        <div className="num text-[15px] font-semibold w-[90px] text-right">
          <Money value={Number(product.price)} />
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => add(product.id, -1)}
            disabled={!qty}
            aria-label={`Remove one ${product.sku}`}
            className="w-9 h-9 border border-line rounded bg-white text-[16px] disabled:opacity-30"
          >
            −
          </button>
          <span className="num w-9 text-center text-[14px] font-semibold" aria-live="polite">
            {qty}
          </span>
          <button
            onClick={() => add(product.id, 1)}
            aria-label={`Add one ${product.sku}`}
            className="w-9 h-9 border border-line rounded bg-white text-[16px] hover:bg-parch"
          >
            +
          </button>
        </div>
      </div>
    </Card>
  );
}
