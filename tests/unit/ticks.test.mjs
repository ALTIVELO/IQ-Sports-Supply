// Axis steps. The top tick is also the top of the plot, so a scale that stops
// one step short draws the tallest column off the top of the chart — which is
// exactly what happened the first time this was rendered.
const { niceTicks } = await import('../../.test-build/dashboard/Charts.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}`
    + (ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`));
};
const top = (max, count) => { const t = niceTicks(max, count); return t[t.length - 1]; };

// ── the property that matters ─────────────────────────────────────────────
for (const max of [1, 2, 3, 6, 7, 9, 10, 23, 99, 100, 101, 999, 1860, 4865,
                   7440, 9234, 10000, 123456, 0.4, 2.5]) {
  for (const count of [2, 3, 4]) {
    for (const whole of [false, true]) {
      const t = niceTicks(max, count, whole);
      const ok = t[t.length - 1] >= max && t[0] === 0 && t.length >= 2
        && (!whole || t.every(Number.isInteger));
      if (!ok) fail++;
      if (!ok) console.log(`FAIL  ticks cover ${max} at count ${count}`
        + `${whole ? ' (whole)' : ''}: ${JSON.stringify(t)}`);
    }
  }
}
console.log('PASS  every scale reaches its maximum, from zero, in at least two steps');
console.log('PASS  and a whole-number scale never offers half of one');

// ── the steps a person would have chosen ──────────────────────────────────
check('six orders over three steps is 0, 2, 4, 6', niceTicks(6, 3, true), [0, 2, 4, 6]);
check('five is 0, 2, 4, 6 as well', niceTicks(5, 3, true), [0, 2, 4, 6]);
check('one order still gets a whole-number scale', niceTicks(1, 3, true), [0, 1]);
check('two orders do not get half-order gridlines', niceTicks(2, 3, true), [0, 1, 2]);
check('a quiet period with no sales at all', niceTicks(0), [0, 1]);
check('and a negative maximum cannot draw anything either', niceTicks(-5), [0, 1]);

check('money rounds to thousands', niceTicks(9234, 4), [0, 2500, 5000, 7500, 10000]);
check('a maximum landing on a tick adds no extra step', niceTicks(10000, 4),
  [0, 2500, 5000, 7500, 10000]);
check('just over a tick steps up rather than overflowing', top(10001, 4), 12000);
check('tens of thousands stay legible', niceTicks(46000, 4), [0, 12500, 25000, 37500, 50000]);

// Floating point: repeatedly adding 2.5 must not overshoot into an extra tick.
check('a decimal step does not drift into an extra tick', niceTicks(10, 4),
  [0, 2.5, 5, 7.5, 10]);

process.exit(fail ? 1 : 0);
