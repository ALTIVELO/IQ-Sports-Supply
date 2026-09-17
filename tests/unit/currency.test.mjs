// Which money a figure is in, and how it reads.
//
// The rule the whole feature rests on is that nothing is ever converted: a
// currency is a label on a number, so the one thing that must never happen is
// a euro figure rendered with a pound sign. Most of these check exactly that.
const { money, currencyOf, CURRENCY_SYMBOL } =
  await import('../../.test-build/lib/format.js');
const { guessMapping } = await import('../../.test-build/import/parse.js');

let fail = 0;
const eq = (label, got, want) => {
  const good = got === want;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`}`);
};

// ── the symbol ────────────────────────────────────────────────────────────
eq('sterling', money(1234.5, 'GBP'), '£1,234.50');
eq('euro', money(1234.5, 'EUR'), '€1,234.50');
eq('no currency given is sterling, as every price was before this existed',
  money(1234.5), '£1,234.50');

// A code we do not hold must not blank the price or throw mid-render. It
// falls back rather than failing, because a page that cannot draw a number is
// worse than one drawing it under the commonest symbol.
eq('an unknown code falls back rather than throwing', money(10, 'USD'), '£10.00');
eq('so does null', money(10, null), '£10.00');
eq('and lower case is not a code', currencyOf('eur'), 'GBP');
eq('EUR is', currencyOf('EUR'), 'EUR');

// ── the shape of the figure ───────────────────────────────────────────────
eq('always two decimals', money(7, 'EUR'), '€7.00');
eq('grouped in thousands', money(1234567.891, 'EUR'), '€1,234,567.89');
eq('rounded, not truncated', money(0.005, 'GBP'), '£0.01');
eq('zero is a figure', money(0, 'EUR'), '€0.00');
// Symbol then figure, so a negative reads "€-40.00". Not the typographer's
// choice, but it is what sterling has always done here, and one currency
// formatting negatives differently from the other would be worse than both
// doing it plainly.
eq('a negative keeps the symbol in front, as sterling always has',
  money(-40, 'EUR'), '€-40.00');
eq('and the two agree with each other', money(-40, 'GBP'), '£-40.00');
eq('a string parses', money('12.5', 'EUR'), '€12.50');
eq('and nonsense is nothing rather than NaN', money('POA', 'EUR'), '€0.00');

// Euro grouping is en-GB on purpose: this is a UK trade counter quoting euros,
// so the digits must read the same way the rest of the screen does.
eq('euro amounts group the way sterling does on the same page',
  money(9999.99, 'EUR').slice(1), money(9999.99, 'GBP').slice(1));

eq('two symbols, and only two', Object.keys(CURRENCY_SYMBOL).join(','), 'GBP,EUR');

// ── finding the column on a price list ────────────────────────────────────
const guess = (header) => guessMapping(header, ['sku', 'currency'])?.currency;
eq('a column headed Currency', guess(['SKU', 'Currency']), 'B');
eq('or Ccy, which is what a finance export calls it', guess(['SKU', 'Ccy']), 'B');
eq('or Curr', guess(['Code', 'Curr', 'Price']), 'B');
eq('nothing to find is not a guess', guess(['SKU', 'Price']), undefined);
// "Current price" is a price column on half the lists we are sent. Reading it
// as the currency would map the wrong column and take the prices with it.
eq('"Current price" is not a currency column', guess(['SKU', 'Current price']), undefined);

process.exit(fail ? 1 : 0);
