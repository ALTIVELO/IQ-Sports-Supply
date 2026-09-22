'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import { useCart } from '../CartContext';
import type { Address } from '../account/AddressBook';
import { placeClientOrder } from '../actions';
import AgencyNotice from '@/components/AgencyNotice';
import QtyStepper from '@/components/QtyStepper';
import type { AgencyBrand, CatalogueItem } from '@/lib/types';
import { currencyOf } from '@/lib/format';
import { totalsByCurrency } from '@/lib/orders/split';
import { OuterNote } from '@/components/OuterPrice';
import { hasOuter, priceAtQty } from '@/lib/catalogue/outer';

/**
 * The basket, line by line, before committing to it.
 *
 * A trade order runs to dozens of lines, so it needs reviewing properly rather
 * than trusting a running total in a sticky bar. Quantities are editable here,
 * Nothing here says whether a line is in stock: every order is placed with our
 * supplier when it arrives, so the answer would be the same on every line and
 * telling a customer "back order" against all of it reads as a warning rather
 * than as how the business works.
 */
export default function BasketReview({
  products, vatRate, paymentDays, addresses, company, agencyBrands,
}: {
  products: CatalogueItem[]; vatRate: number; paymentDays: number; addresses: Address[];
  company: string; agencyBrands: AgencyBrand[];
}) {
  const { quantities, setQty, clear, ready } = useCart();
  const [placed, setPlaced] = useState<{
    orders: {
      number: string; currency: string;
      agencyTerms?: string | null; agentBrand?: string | null;
    }[];
    warning?: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const [addressId, setAddressId] = useState(
    () => addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? '',
  );

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const lines = useMemo(
    () => Object.entries(quantities)
      .map(([id, qty]) => ({ product: byId.get(id), qty }))
      .filter((l): l is { product: CatalogueItem; qty: number } => Boolean(l.product))
      .sort((a, b) => a.product.sku.localeCompare(b.product.sku)),
    [quantities, byId],
  );

  // A product can be withdrawn from the catalogue while it sits in a basket.
  const missing = useMemo(
    () => Object.keys(quantities).filter((id) => !byId.has(id)).length,
    [quantities, byId],
  );

  // An order is raised and invoiced in one currency, so a basket holding both
  // becomes two orders. Rather than refuse it, the totals below are shown per
  // currency — which is what the customer is actually about to be billed —
  // and the split happens on placing.
  const totals = useMemo(
    () => totalsByCurrency(
      lines,
      (l) => currencyOf(l.product.currency),
      // At the rate the quantity actually buys, which is what place_order
      // will charge. A basket that totals three shifters at the carton price
      // is a basket that lies to the customer right up to the invoice.
      (l) => l.qty * priceAtQty(l.product, l.qty),
      vatRate,
    ),
    [lines, vatRate],
  );
  const split = totals.length > 1;

  // What the prices in this basket do not include — DRAG quote ex-works, so
  // duty and VAT are still to come. One line however many products carry it.
  const priceNotes = useMemo(
    () => [...new Set(lines.map((l) => l.product.price_note?.trim()).filter(Boolean))],
    [lines],
  );

  /*
   * The brands in this basket we introduce rather than sell.
   *
   * Told before placing, not after. A customer who finds out on the
   * confirmation that the warranty is somebody else's has been told at the
   * one moment they can no longer act on it.
   */
  const agencyInBasket = useMemo(() => {
    const byKey = new Map(agencyBrands.map((b) => [b.key, b]));
    const keys = new Set(
      lines.map((l) => (l.product.brand ?? '').trim().toLowerCase())
        .filter((k) => byKey.has(k)));
    return [...keys].map((k) => byKey.get(k)!);
  }, [lines, agencyBrands]);

  // Those lines are invoiced by the brand, so they cannot share an order with
  // goods we sell — each agency brand is an order of its own.
  const ownLines = useMemo(
    () => lines.filter((l) =>
      !agencyInBasket.some((b) => b.key === (l.product.brand ?? '').trim().toLowerCase())),
    [lines, agencyInBasket],
  );
  const sellerSplit = agencyInBasket.length + (ownLines.length ? 1 : 0);

  function checkout() {
    setError('');
    startTransition(async () => {
      const r = await placeClientOrder(
        lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        addressId,
      );
      if (r.ok) { setPlaced({ orders: r.orders ?? [], warning: r.warning }); clear(); }
      else setError(r.error ?? 'Could not place your order');
    });
  }

  if (placed) {
    return (
      <Card accent>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
          {placed.orders.length > 1 ? 'Orders ' : 'Order '}
          {placed.orders.map((o) => o.number).join(' and ')} placed
        </h1>
        {placed.orders.length > 1 && (
          <p className="text-[13px] text-mute mt-2 leading-relaxed">
            Your basket was raised as {placed.orders.length} orders —{' '}
            {placed.orders.map((o) => `${o.number} in ${o.currency}`).join(', ')} — each
            with its own invoice. An invoice asks for one currency and comes from one
            seller, so goods in different currencies, or sold by different companies,
            cannot share one.
          </p>
        )}
        {/* Our own goods and an introduced brand's are settled completely
            differently, so the two sentences are told apart rather than
            averaged into one that is wrong for both. */}
        {placed.orders.some((o) => !o.agencyTerms) && (
          <p className="text-[13px] text-mute mt-2 leading-relaxed">
            {placed.orders.filter((o) => !o.agencyTerms).length > 1
              ? 'Your invoices have' : 'Your invoice has'} been raised, due{' '}
            {paymentDays} days from today. Your order has gone straight to our
            supplier. Nothing is dispatched until payment reaches us.
          </p>
        )}
        {placed.orders.filter((o) => o.agencyTerms).map((o) => (
          <div key={o.number} className="mt-3">
            <p className="text-[13px] text-mute mb-2 leading-relaxed">
              Order <span className="num font-semibold">{o.number}</span> is with{' '}
              {o.agentBrand ?? 'the brand'}:
            </p>
            <AgencyNotice terms={o.agencyTerms} brand={o.agentBrand} company={company} />
          </div>
        ))}
        {placed.warning && <div className="mt-3"><Notice tone="info">{placed.warning}</Notice></div>}
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/portal/orders"
                className="text-[13px] font-semibold bg-ink text-white rounded px-4 py-2">
            Track this order
          </Link>
          <Link href="/portal/catalogue"
                className="text-[13px] font-semibold border border-line bg-white rounded px-4 py-2">
            Back to the catalogue
          </Link>
        </div>
      </Card>
    );
  }

  if (!ready) return null;

  if (lines.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Basket</h1>
        <Card>
          <Empty>
            Your basket is empty.{' '}
            <Link href="/portal/catalogue" className="text-flame-text font-semibold">
              Browse the catalogue
            </Link>.
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Basket</h1>
          <p className="text-[13px] text-mute mt-1 num">
            {lines.length} line{lines.length === 1 ? '' : 's'} ·{' '}
            {lines.reduce((a, l) => a + l.qty, 0)} items
          </p>
        </div>
        <Link href="/portal/catalogue" className="text-[12px] text-flame-text font-semibold">
          ← Keep shopping
        </Link>
      </div>

      {error && <Notice>{error}</Notice>}
      {missing > 0 && (
        <Notice tone="info">
          {missing} item{missing === 1 ? ' is' : 's are'} no longer in the catalogue and
          {missing === 1 ? ' has' : ' have'} been left out of this order.
        </Notice>
      )}
      {split && (
        <Notice tone="info">
          This basket holds {totals.map((t) => t.currency).join(' and ')} prices, so it
          will be raised as {totals.length} orders with {totals.length} invoices, one per
          currency. Nothing is converted and nothing is charged twice — the totals below
          are what each invoice will ask for.
        </Notice>
      )}
      {sellerSplit > 1 && (
        <Notice tone="info">
          Not everything in this basket is sold by us. It will be raised as{' '}
          {sellerSplit} separate orders, because the goods below are invoiced by
          different companies and one invoice cannot come from two of them.
        </Notice>
      )}
      {agencyInBasket.map((b) => (
        <AgencyNotice key={b.key} terms={b.terms} brand={b.name} company={company} />
      ))}
      {priceNotes.map((note) => (
        <Notice tone="info" key={note}>{note}</Notice>
      ))}
      {ownLines.length > 0 && (
        <Notice tone="info">
          Everything we sell is ordered from our supplier as soon as you place this
          order. We will confirm dates with you once we have them.
        </Notice>
      )}

      <div className="space-y-2">
        {lines.map(({ product, qty }) => (
          <Card key={product.id} className="!p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <ProductImage src={product.image_url} alt={product.name}
                            className="w-14 h-14 flex-shrink-0" sizePx={112} />
              <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-0">
                <div className="num text-[12px] font-semibold text-mute">{product.sku}</div>
                <div className="text-[13px] font-medium">{product.name}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* The size is what was ordered, so it is named on the line
                      rather than left inside the product name. */}
                  {product.variant_label && (
                    <Tag tone="accent">Size {product.variant_label}</Tag>
                  )}
                  {product.category_name && <Tag tone="line">{product.category_name}</Tag>}
                </div>
              </div>

              <div className="num text-[12px] text-mute w-[80px] text-right">
                <Money value={priceAtQty(product, qty)} currency={product.currency} /> each
              </div>

              {/* Down to nothing, which takes the line off the basket. */}
              <QtyStepper
                value={qty}
                min={0}
                label={product.sku}
                onChange={(next) => setQty(product.id, next)}
              />

              <div className="num text-[15px] font-semibold w-[90px] text-right">
                <Money value={qty * priceAtQty(product, qty)} currency={product.currency} />
              </div>

              <button onClick={() => setQty(product.id, 0)}
                      aria-label={`Remove ${product.sku} from the basket`}
                      className="text-mute hover:text-danger text-[16px] leading-none px-1">
                ×
              </button>

              {/* The last chance to notice. Three of something that comes in
                  tens is priced as three here, and this is the line that says
                  what the other seven would be worth. */}
              {hasOuter(product) && (
                <div className="basis-full">
                  <OuterNote item={product} qty={qty} currency={product.currency} />
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Deliver to</h2>
          <Link href="/portal/account" className="text-[12px] text-flame-text font-semibold">
            Manage addresses
          </Link>
        </div>

        {addresses.length === 0 ? (
          <Notice>
            You have no delivery address on your account yet.{' '}
            <Link href="/portal/account" className="font-semibold underline">
              Add one
            </Link>{' '}before placing this order.
          </Notice>
        ) : addresses.length === 1 ? (
          <div className="text-[12px] text-mute whitespace-pre-line leading-relaxed">
            <span className="font-semibold text-ink">{addresses[0].label}</span>
            {addresses[0].recipient ? `\nFAO ${addresses[0].recipient}` : ''}
            {`\n${addresses[0].address}`}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`border rounded p-3 flex gap-2 cursor-pointer transition-colors
                  ${addressId === a.id ? 'border-ink bg-parch' : 'border-line hover:bg-parch'}`}
              >
                <input
                  type="radio" name="shipping-address" value={a.id}
                  checked={addressId === a.id}
                  onChange={() => setAddressId(a.id)}
                  className="mt-[3px]"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    {a.label}
                    {a.is_default && (
                      <span className="text-[11px] text-mute font-normal"> · default</span>
                    )}
                  </span>
                  {a.recipient && (
                    <span className="block text-[12px] text-mute">FAO {a.recipient}</span>
                  )}
                  <span className="block text-[12px] text-mute whitespace-pre-line leading-relaxed">
                    {a.address}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-end gap-x-8 gap-y-3">
          {/* One block per invoice, stacked, so two currencies read as two
              bills rather than as one long sum across the row. */}
          <div className="flex-1 min-w-0 space-y-2">
            {totals.map((t) => (
              <div key={t.currency}
                   className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
                {split && (
                  <span className="text-[11px] font-semibold text-mute uppercase tracking-wide
                                   mr-auto">
                    {t.currency} invoice
                  </span>
                )}
                <div className="num text-[13px] text-mute text-right">
                  <div>Net <Money value={t.net} currency={t.currency} /></div>
                  {vatRate > 0 && (
                    <div>VAT ({vatRate}%) <Money value={t.vat} currency={t.currency} /></div>
                  )}
                </div>
                <div className="num text-[24px] font-semibold tracking-[-0.02em]
                                min-w-[130px] text-right">
                  <Money value={t.net + t.vat} currency={t.currency} />
                </div>
              </div>
            ))}
          </div>
          <Button kind="accent" onClick={checkout}
                  disabled={pending || addresses.length === 0}>
            {pending
              ? 'Placing…'
              : split ? `Place ${totals.length} orders` : 'Place order'}
          </Button>
        </div>
        <p className="text-[11px] text-mute mt-2 text-right">
          {split ? 'An invoice per currency is' : 'An invoice is'} raised immediately, due{' '}
          {paymentDays} days from today. Nothing is dispatched until payment is received.
        </p>
      </Card>

      <button onClick={clear} className="text-[12px] text-mute hover:text-danger underline">
        Empty the basket
      </button>
    </div>
  );
}
