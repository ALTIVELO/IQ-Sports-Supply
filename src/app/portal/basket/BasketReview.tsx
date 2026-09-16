'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import { useCart } from '../CartContext';
import type { Address } from '../account/AddressBook';
import { placeClientOrder } from '../actions';
import type { CatalogueItem } from '../page';

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
  products, vatRate, paymentDays, addresses,
}: {
  products: CatalogueItem[]; vatRate: number; paymentDays: number; addresses: Address[];
}) {
  const { quantities, setQty, add, clear, ready } = useCart();
  const [placed, setPlaced] = useState<{ number: string; warning?: string } | null>(null);
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

  const net = lines.reduce((a, l) => a + l.qty * Number(l.product.price), 0);
  const vat = (net * vatRate) / 100;

  function checkout() {
    setError('');
    startTransition(async () => {
      const r = await placeClientOrder(
        lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
        addressId,
      );
      if (r.ok) { setPlaced({ number: r.orderNumber ?? '', warning: r.warning }); clear(); }
      else setError(r.error ?? 'Could not place your order');
    });
  }

  if (placed) {
    return (
      <Card accent>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
          Order {placed.number} placed
        </h1>
        <p className="text-[13px] text-mute mt-2 leading-relaxed">
          Your invoice has been raised, due {paymentDays} days from today. Your order has
          gone straight to our supplier. Nothing is dispatched until payment reaches us.
        </p>
        {placed.warning && <div className="mt-3"><Notice tone="info">{placed.warning}</Notice></div>}
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/portal/orders"
                className="text-[13px] font-semibold bg-ink text-white rounded px-4 py-2">
            Track this order
          </Link>
          <Link href="/portal"
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
            <Link href="/portal" className="text-flame-text font-semibold">
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
        <Link href="/portal" className="text-[12px] text-flame-text font-semibold">
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
      <Notice tone="info">
        Everything is ordered from our supplier as soon as you place this order.
        We will confirm dates with you once we have them.
      </Notice>

      <div className="space-y-2">
        {lines.map(({ product, qty }) => (
          <Card key={product.id} className="!p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <ProductImage src={product.image_url} alt={product.name}
                            className="w-14 h-14 flex-shrink-0" sizePx={112} />
              <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-0">
                <div className="num text-[12px] font-semibold text-mute">{product.sku}</div>
                <div className="text-[13px] font-medium">{product.name}</div>
                {product.category_name && (
                  <div className="mt-1">
                    <Tag tone="line">{product.category_name}</Tag>
                  </div>
                )}
              </div>

              <div className="num text-[12px] text-mute w-[80px] text-right">
                <Money value={Number(product.price)} /> each
              </div>

              <div className="flex items-center gap-1">
                <button onClick={() => add(product.id, -1)}
                        aria-label={`Remove one ${product.sku}`}
                        className="w-9 h-9 border border-line rounded bg-white text-[16px]">
                  −
                </button>
                <input
                  type="number" min={0} value={qty}
                  onChange={(e) => setQty(product.id, Math.max(0, Number(e.target.value) || 0))}
                  aria-label={`Quantity of ${product.sku}`}
                  className="num w-16 text-center"
                />
                <button onClick={() => add(product.id, 1)}
                        aria-label={`Add one ${product.sku}`}
                        className="w-9 h-9 border border-line rounded bg-white text-[16px] hover:bg-parch">
                  +
                </button>
              </div>

              <div className="num text-[15px] font-semibold w-[90px] text-right">
                <Money value={qty * Number(product.price)} />
              </div>

              <button onClick={() => setQty(product.id, 0)}
                      aria-label={`Remove ${product.sku} from the basket`}
                      className="text-mute hover:text-danger text-[16px] leading-none px-1">
                ×
              </button>
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
        <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
          <div className="num text-[13px] text-mute text-right">
            <div>Net <Money value={net} /></div>
            {vatRate > 0 && <div>VAT ({vatRate}%) <Money value={vat} /></div>}
          </div>
          <div className="num text-[24px] font-semibold tracking-[-0.02em]">
            <Money value={net + vat} />
          </div>
          <Button kind="accent" onClick={checkout}
                  disabled={pending || addresses.length === 0}>
            {pending ? 'Placing…' : 'Place order'}
          </Button>
        </div>
        <p className="text-[11px] text-mute mt-2 text-right">
          An invoice is raised immediately, due {paymentDays} days from today. Nothing is
          dispatched until payment is received.
        </p>
      </Card>

      <button onClick={clear} className="text-[12px] text-mute hover:text-danger underline">
        Empty the basket
      </button>
    </div>
  );
}
