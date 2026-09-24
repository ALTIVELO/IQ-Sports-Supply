'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Money, Tag } from '@/components/ui';
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
          <AddLine product={lead} />
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
      <AddLine product={size} />
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
 * How many, and then a button that puts them in the basket.
 *
 * The plus used to write straight into the basket: the only sign anything had
 * happened was a number changing in a bar pinned to the bottom of the screen,
 * and the only button on the page said "Place order" — an actual order, with
 * an actual invoice — sitting under the thumb of somebody tapping plus. A
 * counter you can nudge and a decision you have to make are two different
 * things, and they were the same tap.
 *
 * So the stepper counts, and "Add to cart" appears against the row the counter
 * belongs to — beside it where there is room, directly under it on a phone.
 * Until it is pressed, nothing has been added.
 *
 * The count returns to nothing afterwards, because it counts what is about to
 * go in rather than what is already there. What is already there is said
 * underneath, and changed in the basket.
 */
function AddLine({ product }: { product: CatalogueItem }) {
  const { quantities, add } = useCart();
  const [staged, setStaged] = useState(0);
  const [added, setAdded] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The confirmation is on a timer, and a timer outliving the row it belongs
  // to sets state on something that is gone.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const inCart = quantities[product.id] ?? 0;
  const what = product.variant_label
    ? `${product.sku} size ${product.variant_label}`
    : product.sku;

  function commit() {
    if (staged < 1) return;
    add(product.id, staged);
    setAdded(staged);
    setStaged(0);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(0), 4000);
  }

  return (
    <>
      <QtyStepper
        value={staged}
        onChange={(qty) => { setStaged(qty); if (qty > 0) setAdded(0); }}
        label={what}
      />

      {/*
        * Full width on a phone, beside the stepper above that.
        *
        * basis-full drops it on to its own line directly beneath the row whose
        * plus was pressed, which at 430px is where it has to be: there is no
        * room next to a size, a price and three buttons, and a button that
        * wrapped to somewhere else on the card would be a button for nothing
        * in particular.
        */}
      <div className="basis-full sm:basis-auto flex items-center gap-2 sm:ml-1">
        {staged > 0 ? (
          <Button
            small kind="accent" onClick={commit}
            /* The words on it are the same on every row, so on a screen
               reader they would be forty identical buttons without this.
               It opens with what is written on the button rather than
               replacing it: somebody driving the page by voice says what
               they can see, and "add to cart" has to still reach it. */
            aria-label={`Add to cart: ${staged} × ${what}`}
          >
            Add to cart
          </Button>
        ) : added > 0 ? (
          // Announced, because the button that was focused has just been
          // replaced by this and nothing else says the press worked.
          <span
            role="status"
            className="text-[12px] font-semibold text-success whitespace-nowrap"
          >
            {added} added
          </span>
        ) : null}
        {inCart > 0 && (
          <span className="text-[11px] text-mute whitespace-nowrap">
            {inCart} in your basket
          </span>
        )}
      </div>
    </>
  );
}
