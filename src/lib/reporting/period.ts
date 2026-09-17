/**
 * The periods the dashboard reports on, and the window each one compares to.
 *
 * Dates are handled as YYYY-MM-DD strings over UTC arithmetic throughout. The
 * server runs in UTC and the business is in the UK, so "today" is allowed to be
 * a date rather than an instant — but only if nothing here ever constructs a
 * Date from a local-time string, which is where that assumption usually breaks.
 */

export type PeriodKey = '7d' | '30d' | '90d' | '12m' | 'ytd';
export type Grain = 'day' | 'week' | 'month';

export interface Period {
  key: PeriodKey;
  /** For the button. */
  label: string;
  /** For the sentence under the headline figures. */
  description: string;
  from: string;
  to: string;
  grain: Grain;
  /** The window the deltas are measured against. */
  previousFrom: string;
  previousTo: string;
  previousLabel: string;
}

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '12m', label: '12 months' },
  { key: 'ytd', label: 'This year' },
];

export const isPeriodKey = (v: string | undefined): v is PeriodKey =>
  PERIODS.some((p) => p.key === v);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

const addDays = (day: string, n: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Months are added by month number, so 31 Jan + 1 month is not 3 March. */
const addMonths = (day: string, n: number) => {
  const d = utc(day);
  const target = d.getUTCMonth() + n;
  const end = new Date(Date.UTC(d.getUTCFullYear(), target + 1, 0));
  d.setUTCFullYear(d.getUTCFullYear(), target,
    Math.min(d.getUTCDate(), end.getUTCDate()));
  return iso(d);
};

const startOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** A window of whole days ending today, and the one of equal length before it. */
function lastDays(key: PeriodKey, label: string, today: string, days: number, grain: Grain): Period {
  const from = addDays(today, -(days - 1));
  const previousTo = addDays(from, -1);
  return {
    key, label,
    description: `${days} days to ${today}`,
    from, to: today, grain,
    previousFrom: addDays(previousTo, -(days - 1)),
    previousTo,
    previousLabel: `previous ${days} days`,
  };
}

/**
 * Resolves a preset into the dates the report runs on.
 *
 * The month grains start on the first of a month rather than on today's date a
 * year ago, because a chart of months whose first column is two-thirds of a
 * month reads as a collapse in trade rather than as a partial bucket.
 */
export function resolvePeriod(key: PeriodKey, today: string): Period {
  if (key === '7d') return lastDays(key, '7 days', today, 7, 'day');
  if (key === '30d') return lastDays(key, '30 days', today, 30, 'day');
  if (key === '90d') return lastDays(key, '90 days', today, 90, 'week');

  if (key === '12m') {
    const from = startOfMonth(addMonths(today, -11));
    const previousTo = addDays(from, -1);
    return {
      key, label: '12 months',
      description: `12 months to ${today}`,
      from, to: today, grain: 'month',
      previousFrom: startOfMonth(addMonths(previousTo, -11)),
      previousTo,
      previousLabel: 'the 12 months before',
    };
  }

  // This year so far, against the same run of days a year ago — the comparison
  // anyone actually means by "how are we doing this year".
  const from = `${today.slice(0, 4)}-01-01`;
  return {
    key, label: 'This year',
    description: `1 January to ${today}`,
    from, to: today, grain: 'month',
    previousFrom: addMonths(from, -12),
    previousTo: addMonths(today, -12),
    previousLabel: 'the same run last year',
  };
}

/**
 * The change from one figure to another, as a fraction.
 *
 * Null where there is nothing to compare against: a rise from zero is not an
 * increase of any percentage, and reporting one as "+100%" or "+∞%" is worse
 * than saying nothing.
 */
export function delta(now: number, before: number): number | null {
  if (before === 0) return null;
  return (now - before) / before;
}
