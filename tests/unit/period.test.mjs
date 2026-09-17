// The windows the dashboard reports on. Date arithmetic is where reporting
// quietly goes wrong — an off-by-one here and every figure on the screen is
// for the wrong week — so the edges are pinned: month ends, leap days, and
// year boundaries.
const { resolvePeriod, delta, isPeriodKey, PERIODS } =
  await import('../../.test-build/reporting/period.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}`
    + (ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`));
};
const range = (key, today) => {
  const p = resolvePeriod(key, today);
  return [p.from, p.to, p.grain];
};
const prev = (key, today) => {
  const p = resolvePeriod(key, today);
  return [p.previousFrom, p.previousTo];
};

// ── whole-day windows ─────────────────────────────────────────────────────
// Seven days to Wednesday is Thursday to Wednesday: today counts as one of them.
check('7 days includes today and six before it',
  range('7d', '2026-09-17'), ['2026-09-11', '2026-09-17', 'day']);
check('and compares against the seven before those',
  prev('7d', '2026-09-17'), ['2026-09-04', '2026-09-10']);

check('30 days is charted a day at a time',
  range('30d', '2026-09-17'), ['2026-08-19', '2026-09-17', 'day']);
check('90 days is charted a week at a time',
  range('90d', '2026-09-17'), ['2026-06-20', '2026-09-17', 'week']);
check('and compares against the ninety before',
  prev('90d', '2026-09-17'), ['2026-03-22', '2026-06-19']);

// ── crossing a month, a year, and a leap day ──────────────────────────────
check('a window crossing new year counts back through it',
  range('7d', '2026-01-03'), ['2025-12-28', '2026-01-03', 'day']);
check('a window ending on a leap day is still seven days',
  range('7d', '2028-02-29'), ['2028-02-23', '2028-02-29', 'day']);
check('and the one before it ends the day before',
  prev('7d', '2028-03-01'), ['2028-02-17', '2028-02-23']);

// ── months ────────────────────────────────────────────────────────────────
// Starting on the first: a first column holding two-thirds of a month reads as
// a collapse in trade rather than as a partial bucket.
check('12 months starts on the first of the month eleven back',
  range('12m', '2026-09-17'), ['2025-10-01', '2026-09-17', 'month']);
check('and compares against the twelve whole months before',
  prev('12m', '2026-09-17'), ['2024-10-01', '2025-09-30']);
check('12 months from a January is the October before last',
  range('12m', '2026-01-05'), ['2025-02-01', '2026-01-05', 'month']);

// Adding months by month number, not by 30 days: 31 March back eleven months
// is 30 April of the year before, not the 31st of a month with no 31st.
check('a month-end date does not roll into the next month',
  range('12m', '2026-03-31'), ['2025-04-01', '2026-03-31', 'month']);

// ── the year so far ───────────────────────────────────────────────────────
check('this year runs from the first of January',
  range('ytd', '2026-09-17'), ['2026-01-01', '2026-09-17', 'month']);
check('and compares against the same run a year earlier',
  prev('ytd', '2026-09-17'), ['2025-01-01', '2025-09-17']);
check('29 February compares against 28 February',
  prev('ytd', '2028-02-29'), ['2027-01-01', '2027-02-28']);

// ── deltas ────────────────────────────────────────────────────────────────
check('a rise reads as a positive fraction', delta(150, 100), 0.5);
check('a fall reads as a negative one', delta(50, 100), -0.5);
check('no change is zero, not null', delta(100, 100), 0);
check('a rise from nothing has no percentage to report', delta(100, 0), null);
check('and neither does nothing to nothing', delta(0, 0), null);

// ── the keys the URL may carry ────────────────────────────────────────────
check('a known preset is accepted', isPeriodKey('30d'), true);
check('anything else is not', isPeriodKey('everything'), false);
check('nor is a missing one', isPeriodKey(undefined), false);
check('every preset resolves', PERIODS.every((p) => resolvePeriod(p.key, '2026-09-17').from), true);

process.exit(fail ? 1 : 0);
