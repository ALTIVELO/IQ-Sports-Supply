// Characters the invoice PDF cannot print, and what it prints instead.
//
// @react-pdf uses the fourteen standard PDF fonts, and Helvetica among them
// has no euro sign, no dashes beyond the hyphen, no curly quotes and no
// ellipsis. It does not fail on them — it drops the character and closes the
// gap. So "€1,450.00" came out as "1,450.00": a figure on an invoice with no
// currency against it, on every euro order we have ever sent.
//
// Everything the document prints goes through this, so the test is about the
// characters rather than about any one document.
const { pdfSafe } = await import('../../.test-build/pdf/documents.js');

let fail = 0;
const eq = (label, got, want) => {
  const good = got === want;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`}`);
};

// ── the one that costs money ──────────────────────────────────────────────
eq('a euro price says which currency it is in',
   pdfSafe('€1,450.00'), 'EUR 1,450.00');
eq('every figure on the page, not just the first',
   pdfSafe('€1,450.00 and €2,900.00'), 'EUR 1,450.00 and EUR 2,900.00');
// money() emits the symbol tight against the digits; "EUR1,450" would read
// as a part number.
eq('with a space after it', pdfSafe('€99'), 'EUR 99');
eq('and not two, where there was already one', pdfSafe('€ 99'), 'EUR 99');

// Sterling and dollars are in the font and must be left exactly alone.
eq('sterling is printable and untouched', pdfSafe('£1,450.00'), '£1,450.00');
eq('so are dollars', pdfSafe('$99.00'), '$99.00');

// ── prose ─────────────────────────────────────────────────────────────────
// Every one of these appears in copy this codebase already writes.
eq('an em dash becomes a hyphen', pdfSafe('help with it — tell us'), 'help with it - tell us');
eq('so does an en dash', pdfSafe('1–2 days'), '1-2 days');
eq('curly apostrophes straighten', pdfSafe('the brand’s invoice'), "the brand's invoice");
eq('so do curly quotes', pdfSafe('he said “no”'), 'he said "no"');
eq('an ellipsis spells itself out', pdfSafe('Sending…'), 'Sending...');
eq('an arrow too', pdfSafe('placed → shipped'), 'placed -> shipped');

// A non-breaking space prints, but never wraps, so a long line carrying one
// runs off the page instead of breaking.
eq('a non-breaking space becomes one that breaks',
   pdfSafe('IQ Sports Supply'), 'IQ Sports Supply');

// ── everything else is left alone ─────────────────────────────────────────
eq('accented letters are in the font', pdfSafe('café'), 'café');
eq('the middle dot is too', pdfSafe('a · b'), 'a · b');
eq('ordinary text is unchanged',
   pdfSafe('DRAG Omega Comp 56cm'), 'DRAG Omega Comp 56cm');
eq('an empty string stays empty', pdfSafe(''), '');

process.exit(fail ? 1 : 0);
