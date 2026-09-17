'use client';

import { useMemo, useState } from 'react';
import { Button, Money } from '@/components/ui';
import type { DeskBuild, DeskProduct, DeskStep } from './page';
import { buildLines, missingSteps, preselect, type Chosen } from '@/lib/orders/build';

/**
 * A groupset specced at the counter.
 *
 * The portal's builder is a page a customer reads: pictures, stock badges,
 * one card per option. This is the same choice made by somebody on the phone,
 * so it is a column of dropdowns and a total — every step visible at once,
 * keyboard-reachable, and no scrolling to find the one that is still blank.
 *
 * What it adds to the order is the components, not the build: each chosen
 * option goes on as its own line at its own SKU and price, because that is
 * what the warehouse picks and what the invoice has to show. The build is a
 * way of choosing, not a thing we sell.
 */
export default function DeskBuild({
  build, products, priceFor, stockAt, locationId, onAdd, onClose,
}: {
  build: DeskBuild;
  /** Product id → the catalogue row, for price, stock and SKU. */
  products: Map<string, DeskProduct>;
  priceFor: (p: DeskProduct) => number;
  stockAt: (p: DeskProduct, locationId: string) => number;
  locationId: string;
  /** Called with one entry per component, quantities already multiplied. */
  onAdd: (lines: { product: DeskProduct; qty: number }[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Chosen>(() => preselect(build.steps));
  const [kits, setKits] = useState(1);

  const lines = useMemo(
    () => buildLines(build.steps, chosen, kits)
      .map((l) => ({ ...l, product: products.get(l.productId) }))
      .filter((l): l is typeof l & { product: DeskProduct } => Boolean(l.product)),
    [build.steps, chosen, kits, products],
  );

  const missing = missingSteps(build.steps, chosen);
  const net = lines.reduce((a, l) => a + priceFor(l.product) * l.qty, 0);
  const currency = lines[0]?.product.currency ?? 'GBP';

  // Every component of one build should be in one currency; if a catalogue
  // ever mixed them the order would split, so say so here instead.
  const currencies = [...new Set(lines.map((l) => l.product.currency))];

  /** "170mm · 52-36" — the two things a chainset is specified by, as one label. */
  const label = (o: DeskStep['options'][number]) => {
    const axes = [o.axis1_value, o.axis2_value].filter(Boolean).join(' · ');
    const product = products.get(o.product_id);
    return [o.label?.trim() || axes || product?.name || product?.sku, product?.sku]
      .filter(Boolean).join('  ');
  };

  return (
    <div className="border border-ink rounded mt-1.5 p-3 space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold">{build.name}</span>
        {build.brand && <span className="text-[12px] text-mute">{build.brand}</span>}
        <button onClick={onClose}
                className="ml-auto text-[12px] text-mute hover:text-ink underline">
          Close
        </button>
      </div>

      <div className="space-y-1.5">
        {build.steps.map((step) => {
          const product = products.get(chosen[step.id] ?? '');
          const here = product ? stockAt(product, locationId) : 0;
          return (
            <div key={step.id} className="flex flex-wrap items-center gap-2">
              <label className="text-[12px] font-semibold min-w-[110px]" htmlFor={step.id}>
                {step.name}
                {step.qty > 1 && <span className="text-mute font-normal"> ×{step.qty}</span>}
                {!step.required && <span className="text-mute font-normal"> (optional)</span>}
              </label>
              <select
                id={step.id}
                className="flex-1 min-w-[220px] num text-[12px]"
                value={chosen[step.id] ?? ''}
                onChange={(e) => setChosen((c) => ({ ...c, [step.id]: e.target.value }))}
              >
                <option value="">
                  {step.required ? `Choose ${step.name.toLowerCase()}…` : 'None'}
                </option>
                {step.options.map((o) => (
                  <option key={o.id} value={o.product_id}>{label(o)}</option>
                ))}
              </select>
              {product && (
                <>
                  <span className={`num text-[11px] ${here > 0 ? 'text-success' : 'text-danger'}`}>
                    {here > 0 ? `${here} here` : 'back order'}
                  </span>
                  <span className="num text-[12px] font-semibold w-[90px] text-right">
                    <Money value={priceFor(product)} currency={product.currency} />
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-row-line">
        <label className="text-[12px] font-semibold" htmlFor={`${build.id}-kits`}>
          Builds
        </label>
        <input
          id={`${build.id}-kits`} type="number" min={1} value={kits}
          onChange={(e) => setKits(Math.max(1, Number(e.target.value) || 1))}
          className="num w-16"
        />
        <span className="text-[12px] text-mute">
          {missing.length > 0
            ? `Still to choose: ${missing.map((s) => s.name).join(', ')}`
            : `${lines.length} component${lines.length === 1 ? '' : 's'}`}
        </span>
        <span className="num text-[16px] font-semibold ml-auto">
          <Money value={net} currency={currency} />
        </span>
        <Button
          small kind="accent"
          disabled={missing.length > 0 || currencies.length > 1 || !lines.length}
          onClick={() => {
            onAdd(lines.map((l) => ({ product: l.product, qty: l.qty })));
            onClose();
          }}
        >
          Add to order
        </Button>
      </div>

      {currencies.length > 1 && (
        <p className="text-[12px] text-danger">
          This build mixes {currencies.join(' and ')} components, which cannot go on one
          order. Price them in one currency on the catalogue screen first.
        </p>
      )}
    </div>
  );
}
