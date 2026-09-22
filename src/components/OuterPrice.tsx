'use client';

import { Money } from '@/components/ui';
import { hasOuter, priceAtQty, shortOfOuter, outerSaving,
         type OuterPriced } from '@/lib/catalogue/outer';

/**
 * Two prices where a part is sold by the carton: what one costs, and what one
 * costs inside a full outer.
 *
 * The loose price sits to the left and the outer price to the right, because
 * left to right is dearest-first and that is the order somebody reads it in:
 * this is what one costs, and this is what one costs if you take the box. The
 * rate that applies to the quantity currently chosen is the bold one, so a
 * customer never has to work out which of the two they are on.
 *
 * A product sold in ones renders as it always did — one price, no annotation —
 * which is most of the catalogue and must stay quiet.
 */
export default function OuterPrice({
  item, qty, currency, className = '',
}: {
  item: OuterPriced;
  /** What is on the order now. Zero before anything is chosen. */
  qty: number;
  currency: string | null;
  className?: string;
}) {
  if (!hasOuter(item)) {
    return (
      <span className={`num font-semibold ${className}`}>
        <Money value={item.price} currency={currency} />
      </span>
    );
  }

  const atOuter = qty >= (item.moq as number);

  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span
        className={`num ${atOuter ? 'text-[11px] text-mute' : 'font-semibold'}`}
        title={`Fewer than ${item.moq}`}
      >
        <Money value={item.break_price as number} currency={currency} />
      </span>
      <span className="text-[10px] text-mute">/</span>
      <span
        className={`num ${atOuter ? 'font-semibold' : 'text-[11px] text-mute'}`}
        title={`${item.moq} or more`}
      >
        <Money value={item.price} currency={currency} />
      </span>
    </span>
  );
}

/**
 * The line underneath: how many make a carton, and what the next few are
 * worth.
 *
 * Two different sentences on purpose. Before anything is chosen it is a fact
 * about the product. Once a quantity is on the order and it is short, it is
 * an offer with a number on it — "3 more for the box price" is a suggestion,
 * "3 more and the line costs £132 less" is a reason.
 */
export function OuterNote({
  item, qty, currency, className = '',
}: {
  item: OuterPriced; qty: number; currency: string | null; className?: string;
}) {
  if (!hasOuter(item)) return null;

  const short = shortOfOuter(item, qty);
  const saving = outerSaving(item, qty);

  return (
    <span className={`text-[11px] text-mute ${className}`}>
      {short > 0 ? (
        <>
          {short} more make an outer of {item.moq}
          {/* Only where it is actually a saving. A carton of a hundred
              charging cables to save on three is not an offer anybody wants
              made to them as one, and the arithmetic says so on its own. */}
          {saving > 0 && (
            <>
              {' — '}
              <Money value={saving} currency={currency} className="font-semibold" />
              {' off this line'}
            </>
          )}
        </>
      ) : qty >= (item.moq as number) ? (
        <>Outer price — {item.moq} or more</>
      ) : (
        <>Sold in outers of {item.moq}; fewer cost{' '}
          <Money value={item.break_price as number} currency={currency} /> each</>
      )}
    </span>
  );
}

/** The rate a given quantity is on, for a line total. */
export const rateFor = (item: OuterPriced, qty: number) => priceAtQty(item, qty);
