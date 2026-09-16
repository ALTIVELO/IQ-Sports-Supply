'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Empty, Field, Money, Notice, Tag } from '@/components/ui';
import ProductImage from '@/components/ProductImage';
import { useCart } from '../../CartContext';

export interface GroupOption {
  option_id: string; step_id: string; product_id: string;
  label: string; sort: number; sku: string;
  price: number; in_stock: boolean; image_url: string | null;
  axis1_value: string | null; axis2_value: string | null;
}

export interface GroupStep {
  id: string; name: string; hint: string | null;
  qty: number; required: boolean; sort: number;
  /** Named when the step is specified by two things at once, like a chainset. */
  axis1_name: string | null; axis2_name: string | null;
  options: GroupOption[];
}

/**
 * Choose one option per step, then add the lot to the basket.
 *
 * Each chosen component goes in as its own basket line, at its own SKU and
 * price — which is what the warehouse picks and what the invoice has to show.
 * The build is a way of choosing, not a thing we sell.
 */
export default function GroupBuilder({
  name, brand, description, imageUrl, categoryName, categorySlug, steps, vatRate,
}: {
  name: string; brand: string | null; description: string | null;
  imageUrl: string | null; categoryName: string | null; categorySlug: string | null;
  steps: GroupStep[]; vatRate: number;
}) {
  const { add } = useCart();
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    // Preselect only where there is genuinely no decision to make: a required
    // step with one option. An optional step is never preselected, however few
    // options it has — a lone optional extra is still an extra, and quietly
    // adding a power meter to someone's groupset is not a convenience.
    const initial: Record<string, string> = {};
    for (const s of steps) {
      if (s.required && s.options.length === 1) initial[s.id] = s.options[0].option_id;
    }
    return initial;
  });
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(0);

  const isBuild = steps.length > 1;

  const picked = useMemo(
    () => steps
      .map((s) => ({ step: s, option: s.options.find((o) => o.option_id === chosen[s.id]) }))
      .filter((x): x is { step: GroupStep; option: GroupOption } => Boolean(x.option)),
    [steps, chosen],
  );

  const missing = steps.filter((s) => s.required && !chosen[s.id]);
  const net = picked.reduce((a, p) => a + Number(p.option.price) * p.step.qty, 0) * qty;
  const vat = (net * vatRate) / 100;

  function addAll() {
    for (const p of picked) add(p.option.product_id, p.step.qty * qty);
    setAdded(picked.length);
  }

  if (!steps.length) {
    return (
      <Card>
        <Empty>
          This product is not available to configure just now.{' '}
          <Link href="/portal" className="text-flame-text font-semibold">
            Back to the catalogue
          </Link>.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <ProductImage src={imageUrl} alt={name} className="w-24 h-24 flex-shrink-0" sizePx={192} />
        <div className="min-w-0 flex-1">
          {categorySlug && (
            <Link href={`/portal/c/${categorySlug}`} className="text-[12px] text-flame-text font-semibold">
              ← {categoryName}
            </Link>
          )}
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] mt-1">{name}</h1>
          <p className="text-[13px] text-mute mt-1">
            {brand}
            {brand && ' · '}
            {isBuild
              ? `Choose each part below — ${steps.length} choices to make.`
              : 'Choose the option you need.'}
          </p>
          {description && (
            <p className="text-[13px] text-mute mt-2 leading-relaxed whitespace-pre-line">
              {description}
            </p>
          )}
        </div>
      </div>

      {added > 0 && (
        <Notice tone="success">
          {added} line{added === 1 ? '' : 's'} added to your basket.{' '}
          <Link href="/portal/basket" className="font-semibold underline">Review the basket</Link>
          {' '}or keep changing your choices and add again.
        </Notice>
      )}

      {steps.map((step, i) => (
        <Card key={step.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-semibold">
              {isBuild && <span className="text-mute font-normal">{i + 1}. </span>}
              {step.name}
            </h2>
            {step.qty > 1 && <Tag tone="line">{step.qty} needed</Tag>}
            {!step.required && <span className="text-[12px] text-mute">Optional</span>}
            {step.hint && <span className="text-[12px] text-mute">{step.hint}</span>}
          </div>

          {step.options.length === 0 ? (
            <Empty>Nothing available for this part at the moment.</Empty>
          ) : step.axis1_name ? (
            <AxisPicker
              step={step}
              chosenId={chosen[step.id]}
              onChoose={(id) => setChosen((c) => ({ ...c, [step.id]: id }))}
            />
          ) : step.options.length === 1 && step.required ? (
            // Nothing to decide. Say what is included and move on rather than
            // making someone confirm the only answer.
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Tag tone="ink">Included</Tag>
              <span className="font-medium">{step.options[0].label}</span>
              <span className="num text-[11px] text-mute">{step.options[0].sku}</span>
              <span className="num text-mute ml-auto">
                <Money value={Number(step.options[0].price)} />
              </span>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {step.options.map((o) => {
                const on = chosen[step.id] === o.option_id;
                return (
                  <label
                    key={o.option_id}
                    className={`border rounded p-3 flex gap-2 cursor-pointer transition-colors
                      ${on ? 'border-ink bg-parch' : 'border-line hover:bg-parch'}`}
                  >
                    <input
                      type="radio" name={`step-${step.id}`} value={o.option_id} checked={on}
                      onChange={() => setChosen((c) => ({ ...c, [step.id]: o.option_id }))}
                      className="mt-[3px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{o.label}</span>
                      <span className="num block text-[11px] text-mute">{o.sku}</span>
                      <span className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="num text-[13px] font-semibold">
                          <Money value={Number(o.price)} />
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {!step.required && (
            chosen[step.id] ? (
              <button
                onClick={() => setChosen((c) => {
                  const next = { ...c }; delete next[step.id]; return next;
                })}
                className="text-[12px] text-mute hover:text-ink underline"
              >
                Leave this out
              </button>
            ) : (
              <p className="text-[12px] text-mute">Not included. Pick one above to add it.</p>
            )
          )}
        </Card>
      ))}

      <Card className="space-y-3">
        <h2 className="text-[15px] font-semibold">
          {isBuild ? 'Your build' : 'Your choice'}
        </h2>

        {picked.length === 0 ? (
          <Empty>Nothing chosen yet.</Empty>
        ) : (
          <div className="space-y-1">
            {picked.map(({ step, option }) => (
              <div key={step.id}
                   className="text-[13px] py-1 border-b border-line/60 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-mute w-[88px] flex-shrink-0">{step.name}</span>
                  <span className="flex-1 min-w-0 font-medium">{option.label}</span>
                  <span className="num font-semibold">
                    <Money value={step.qty * qty * Number(option.price)} />
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-mute sm:pl-[96px]">
                  <span className="num">{option.sku}</span>
                  <span className="num">
                    {step.qty * qty} × <Money value={Number(option.price)} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <Notice tone="info">
            Still to choose: {missing.map((s) => s.name).join(', ')}.
          </Notice>
        )}
        <Notice tone="info">
          Every part is ordered from our supplier as soon as you place the order.
          We will confirm dates with you once we have them.
        </Notice>

        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3 pt-1">
          <label className="flex items-center gap-2 text-[12px] font-semibold mr-auto">
            {isBuild ? 'How many builds' : 'Quantity'}
            <input
              type="number" min={1} value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="num w-20 text-center"
            />
          </label>
          <div className="num text-[13px] text-mute text-right">
            <div>Net <Money value={net} /></div>
            {vatRate > 0 && <div>VAT ({vatRate}%) <Money value={vat} /></div>}
          </div>
          <div className="num text-[24px] font-semibold tracking-[-0.02em]">
            <Money value={net + vat} />
          </div>
          <Button kind="accent" onClick={addAll} disabled={missing.length > 0 || !picked.length}>
            Add to basket
          </Button>
        </div>

        <p className="text-[11px] text-mute text-right">
          Each part goes into your basket as its own line, at its own SKU — so you can
          change or remove any of them before ordering.
        </p>
      </Card>
    </div>
  );
}

/**
 * A part specified by two things at once — a chainset is a crank length and a
 * chainring pair, and there are sixteen of them.
 *
 * One control per axis, and the pair resolves to the single SKU that is both.
 * Values that no remaining SKU offers are disabled rather than hidden, so the
 * gaps in the range are visible: there is no 54/40 at 160mm, and being told
 * that is more use than watching the option quietly disappear.
 */
function AxisPicker({ step, chosenId, onChoose }: {
  step: GroupStep;
  chosenId: string | undefined;
  onChoose: (optionId: string) => void;
}) {
  const chosen = step.options.find((o) => o.option_id === chosenId);
  const [a1, setA1] = useState<string | null>(chosen?.axis1_value ?? null);
  const [a2, setA2] = useState<string | null>(chosen?.axis2_value ?? null);

  const values = (pick: (o: GroupOption) => string | null) =>
    [...new Set(step.options.map(pick).filter((v): v is string => Boolean(v)))]
      .sort((x, y) => parseFloat(x) - parseFloat(y) || x.localeCompare(y));

  const axis1Values = values((o) => o.axis1_value);
  const axis2Values = step.axis2_name ? values((o) => o.axis2_value) : [];

  const resolve = (v1: string | null, v2: string | null) =>
    step.options.find((o) =>
      o.axis1_value === v1 && (!step.axis2_name || o.axis2_value === v2)) ?? null;

  function pick(v1: string | null, v2: string | null) {
    setA1(v1); setA2(v2);
    const hit = resolve(v1, v2);
    if (hit) onChoose(hit.option_id);
  }

  const current = resolve(a1, a2);
  const offered = (axis: 1 | 2, value: string) => step.options.some((o) =>
    axis === 1
      ? o.axis1_value === value && (!step.axis2_name || !a2 || o.axis2_value === a2)
      : o.axis2_value === value && (!a1 || o.axis1_value === a1));

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={step.axis1_name ?? ''}>
          <select value={a1 ?? ''} onChange={(e) => pick(e.target.value || null, a2)}>
            <option value="">— choose —</option>
            {axis1Values.map((v) => (
              <option key={v} value={v} disabled={!offered(1, v)}>
                {v}{offered(1, v) ? '' : ' — not available with this selection'}
              </option>
            ))}
          </select>
        </Field>
        {step.axis2_name && (
          <Field label={step.axis2_name}>
            <select value={a2 ?? ''} onChange={(e) => pick(a1, e.target.value || null)}>
              <option value="">— choose —</option>
              {axis2Values.map((v) => (
                <option key={v} value={v} disabled={!offered(2, v)}>
                  {v}{offered(2, v) ? '' : ' — not available with this selection'}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {current ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] border border-ink
                        bg-parch rounded p-3">
          <span className="font-semibold">{current.label}</span>
          <span className="num text-[11px] text-mute">{current.sku}</span>
          <span className="num font-semibold ml-auto">
            <Money value={Number(current.price)} />
          </span>
        </div>
      ) : (
        <p className="text-[12px] text-mute">
          {a1 || a2
            ? 'That combination is not made — try another.'
            : `Choose ${[step.axis1_name, step.axis2_name].filter(Boolean).join(' and ')}.`}
        </p>
      )}
    </div>
  );
}
