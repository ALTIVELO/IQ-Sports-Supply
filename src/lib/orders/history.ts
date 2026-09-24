import { totalsByCurrency } from './split';

/** Only what a summary needs, so any order-shaped row can be counted. */
export interface HistoryOrder {
  date: string;
  status: string;
  currency: string | null;
  order_lines: { qty: number; unit_price: number }[];
}

export interface History {
  /** Orders that count: everything not cancelled. */
  placed: number;
  cancelled: number;
  /** Earliest and latest order date among the ones that count, or null. */
  first: string | null;
  last: string | null;
  /** Net spend per currency, cancelled orders left out. */
  totals: { currency: string; net: number }[];
}

export const orderNet = (o: HistoryOrder): number =>
  o.order_lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price), 0);

/**
 * What one client has bought from us.
 *
 * Cancelled orders are counted and then left out of everything else. Left in,
 * a cancelled order inflates lifetime spend by money that never arrived;
 * dropped silently, the count on the screen disagrees with the rows under it
 * and the first thing anybody does is wonder which is wrong. So they are
 * stated separately and excluded from the money.
 *
 * Per currency rather than as one number: we buy from Italy in euros and sell
 * in both, and adding the two together would need a rate, which would be
 * today's rate applied to an order placed at last year's. A screen that says
 * two figures is telling the truth; one that says a single total is not.
 */
export function summarise(orders: HistoryOrder[]): History {
  const counted = orders.filter((o) => o.status !== 'cancelled');
  const dates = counted.map((o) => o.date).filter(Boolean).sort();

  return {
    placed: counted.length,
    cancelled: orders.length - counted.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    // Net, so VAT is asked for as zero — what a client has spent with us is
    // what we charged for the goods, not what we collected for HMRC.
    totals: totalsByCurrency(
      counted, (o) => o.currency ?? 'GBP', orderNet, 0,
    ).map(({ currency, net }) => ({ currency, net })),
  };
}
