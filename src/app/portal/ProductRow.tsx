'use client';

import { useState } from 'react';
import { Card, Money, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import QtyStepper from '@/components/QtyStepper';
import { useCart } from './CartContext';
import OuterPrice, { OuterNote } from '@/components/OuterPrice';
import { hasOuter } from '@/lib/catalogue/outer';
import { groupName, skuPrefix, type VariantGroup } from '@/lib/catalogue/variants';
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
          zoom
        />

        {/* On a phone the name takes the whole width. Squeezed into what is
            left beside a picture, a price and a button, every word of
            "Dura-Ace FC-R9200 Chainset" wraps onto its own line. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          {/* A range is quoted by the part number its sizes share; a product
              sold on its own by its own. Nothing is drawn where a range's
              SKUs have no useful prefix in common. */}
          {(sized ? skuPrefix(group.sizes.map((s) => s.sku)) : lead.sku) && (
            <div className="num text-[12px] font-semibold text-mute">
              {sized ? skuPrefix(group.sizes.map((s) => s.sku)) : lead.sku}
            </div>
          )}
          <div className="text-[13px] font-medium">{name}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Brand, then the range, then what it is: the order a shop says
                them in, and the order they narrow the catalogue down. */}
            {lead.brand && <span className="text-[11px] text-mute">{lead.brand}</span>}
            {lead.series && <Tag tone="ink">{lead.series}</Tag>}
            {lead.category_name && <Tag tone="line">{lead.category_name}</Tag>}
            {sized && (
              <span className="text-[11px] text-mute">
                {group.sizes.length} sizes
                {/* The list of them is a luxury on a phone: it is three lines
                    of wrapped text above a button that shows the same thing. */}
                <span className="hidden sm:inline">
                  {' · '}{group.sizes.map((s) => s.variant_label).join(' · ')}
                </span>
              </span>
            )}
          </div>
          {lead.price_note && (
            <div className="text-[11px] text-mute mt-1">{lead.price_note}</div>
          )}
        </div>

        <div className="text-[15px] w-[150px] text-right">
          {/* A range only where there is one. Five sizes at one price is one
              price, and "from" in front of it would read as a catch. */}
          {group.low !== group.high && <span className="text-[11px] text-mute">from </span>}
          {/* A collapsed range quotes its lead's two prices rather than the
              range's low, because the low is one number and the thing being
              explained is that there are two. A single product does the same
              with its own. */}
          {sized && group.low !== group.high
            ? <span className="num font-semibold">
                <Money value={group.low} currency={lead.currency} />
              </span>
            : <OuterPrice item={lead} qty={inBasket} currency={lead.currency} />}
          {hasOuter(lead) && (
            <div className="mt-0.5">
              <OuterNote item={lead} qty={inBasket} currency={lead.currency} />
            </div>
          )}
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
      {/* Wide enough for "52/36 172.5mm", which is what a size is here now:
          w-10 was written for "XL" and broke a chainset over two lines. */}
      <span className="text-[13px] font-semibold min-w-[6.5rem]">{size.variant_label}</span>
      <span className="num text-[11px] text-mute flex-1 min-w-0 truncate">{size.sku}</span>
      {size.in_stock
        ? <Tag tone="green">in stock</Tag>
        : <Tag tone="line">to order</Tag>}
      <span className="text-[14px] w-[140px] text-right">
        <OuterPrice item={size} qty={qty} currency={size.currency} />
      </span>
      <Stepper product={size} />
      {/* Its own line, full width, so the offer is not squeezed between a
          price and a pair of buttons at 430px. */}
      {hasOuter(size) && (
        <div className="basis-full text-right">
          <OuterNote item={size} qty={qty} currency={size.currency} />
        </div>
      )}
    </div>
  );
}

/**
 * One product's quantity, against the cart rather than against a field.
 *
 * The control itself is shared with the order desk and the basket, so a
 * customer counting frames and the person on the phone counting them for
 * somebody else are working the same buttons.
 */
function Stepper({ product }: { product: CatalogueItem }) {
  const { quantities, setQty } = useCart();
  const what = product.variant_label
    ? `${product.sku} size ${product.variant_label}`
    : product.sku;

  return (
    <QtyStepper
      value={quantities[product.id] ?? 0}
      onChange={(qty) => setQty(product.id, qty)}
      label={what}
    />
  );
}
