'use client';

import { useState } from 'react';
import { Card, Money, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import { useCart } from './CartContext';
import { groupName, type VariantGroup } from '@/lib/catalogue/variants';
import type { CatalogueItem } from '@/lib/types';

/**
 * One catalogue line.
 *
 * A bike built in five frame sizes is one line here, not five: the sizes open
 * underneath when it is clicked, and the quantity is set against the size,
 * because the size is what gets ordered, picked and shipped. A product sold as
 * one thing keeps the stepper on the row, where it has always been, and never
 * asks anybody to open anything.
 */
export default function ProductRow({ group }: { group: VariantGroup }) {
  const { quantities } = useCart();
  const [open, setOpen] = useState(false);

  const sized = group.sizes.length > 1;
  const inBasket = group.sizes.reduce((a, s) => a + (quantities[s.id] ?? 0), 0);
  const chosen = group.sizes.filter((s) => (quantities[s.id] ?? 0) > 0).length;
  const lead = group.lead;
  const name = groupName(group);

  // Opened by hand, or left open because there is something of it in the
  // basket — closing a bike you have just put two frames of hides the fact.
  const showSizes = sized && (open || inBasket > 0);

  return (
    <Card className={`!p-3 ${inBasket > 0 ? 'border-flame' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ProductImage
          src={lead.image_url}
          alt={name}
          className="w-14 h-14 flex-shrink-0"
          sizePx={112}
        />

        <div className="min-w-0 flex-1">
          <div className="num text-[12px] font-semibold text-mute">
            {sized ? lead.sku.replace(/[-_ ]?[A-Z0-9]+$/i, '') : lead.sku}
          </div>
          <div className="text-[13px] font-medium">{name}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {lead.brand && <span className="text-[11px] text-mute">{lead.brand}</span>}
            {lead.category_name && <Tag tone="line">{lead.category_name}</Tag>}
            {sized && (
              <span className="text-[11px] text-mute">
                {group.sizes.length} sizes · {group.sizes.map((s) => s.variant_label).join(' ')}
              </span>
            )}
          </div>
          {lead.price_note && (
            <div className="text-[11px] text-mute mt-1">{lead.price_note}</div>
          )}
        </div>

        <div className="num text-[15px] font-semibold w-[110px] text-right">
          {/* A range only where there is one. Five sizes at one price is one
              price, and "from" in front of it would read as a catch. */}
          {group.low !== group.high && <span className="text-[11px] text-mute">from </span>}
          <Money value={group.low} currency={lead.currency} />
        </div>

        {sized ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={showSizes}
            className="text-[12px] font-semibold border border-line rounded px-3 h-9
                       bg-white hover:bg-parch whitespace-nowrap"
          >
            {chosen > 0
              ? `${chosen} size${chosen === 1 ? '' : 's'} · ${inBasket}`
              : showSizes ? 'Hide sizes' : 'Choose size'}
          </button>
        ) : (
          <Stepper product={lead} />
        )}
      </div>

      {showSizes && (
        <div className="mt-3 pt-3 border-t border-row-line space-y-1.5">
          {group.sizes.map((size) => <SizeRow key={size.id} size={size} />)}
        </div>
      )}
    </Card>
  );
}

/** One frame size: what it costs, whether we hold it, and how many you want. */
function SizeRow({ size }: { size: CatalogueItem }) {
  const { quantities } = useCart();
  const qty = quantities[size.id] ?? 0;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded px-2 py-1.5
                     ${qty > 0 ? 'bg-parch' : ''}`}>
      <span className="text-[13px] font-semibold w-10">{size.variant_label}</span>
      <span className="num text-[11px] text-mute flex-1 min-w-0 truncate">{size.sku}</span>
      {size.in_stock
        ? <Tag tone="green">in stock</Tag>
        : <Tag tone="line">to order</Tag>}
      <span className="num text-[14px] font-semibold w-[90px] text-right">
        <Money value={Number(size.price)} currency={size.currency} />
      </span>
      <Stepper product={size} />
    </div>
  );
}

function Stepper({ product }: { product: CatalogueItem }) {
  const { quantities, add } = useCart();
  const qty = quantities[product.id] ?? 0;
  const what = product.variant_label
    ? `${product.sku} size ${product.variant_label}`
    : product.sku;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => add(product.id, -1)}
        disabled={!qty}
        aria-label={`Remove one ${what}`}
        className="w-9 h-9 border border-line rounded bg-white text-[16px] disabled:opacity-30"
      >
        −
      </button>
      <span className="num w-9 text-center text-[14px] font-semibold" aria-live="polite">
        {qty}
      </span>
      <button
        onClick={() => add(product.id, 1)}
        aria-label={`Add one ${what}`}
        className="w-9 h-9 border border-line rounded bg-white text-[16px] hover:bg-parch"
      >
        +
      </button>
    </div>
  );
}
