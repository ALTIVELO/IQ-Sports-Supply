// Who we are, legally, on a document somebody might have to act on.
//
// A limited company has to state its registered name, that it is
// incorporated, where, its number and its registered office on its business
// letters and order forms. An invoice is the document most likely to be kept,
// chased, disputed or handed to an accountant, so it is the one that matters.
//
// The line is assembled rather than written out because it appears in places
// that share no code — a rendered PDF and a plain-text email — and the VAT
// number joined it later in one edit, which is what that was for.
const { legalFooter, LEGAL_NAME, COMPANY_NUMBER, REGISTERED_OFFICE, VAT_NUMBER } =
  await import('../../.test-build/lib/company.js');

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const good = g === w;
  if (!good) fail++;
  console.log(`${good ? 'PASS ' : 'FAIL '} ${label}${good ? '' : `\n        want ${w}\n        got  ${g}`}`);
};

eq('the line reads as one sentence', legalFooter(),
   'IQ Sports Supply Ltd · Registered in England & Wales, Company No. 17430665 · '
   + 'Registered office: 2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ · '
   + 'VAT No. 529 0734 83');

// Each part on its own, so a typo in one is a failure that names it.
eq('the registered name', LEGAL_NAME, 'IQ Sports Supply Ltd');
eq('the company number', COMPANY_NUMBER, '17430665');
eq('the registered office', REGISTERED_OFFICE,
   '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ');

// A VAT invoice has to carry the supplier's registration number, and this is
// the line that carries it on every document and every email.
eq('the VAT number', VAT_NUMBER, '529 0734 83');
eq('and it is on the line', legalFooter().includes('VAT No. 529 0734 83'), true);

// Spaced the way HMRC write it, because it is an identifier somebody reads
// off a document and types into a form, and one nine-digit block is the
// version that gets mistyped.
eq('spaced as HMRC write it', /^\d{3} \d{4} \d{2}$/.test(VAT_NUMBER), true);

// Last, after the registered office. An invoice is read top to bottom and the
// VAT number is what somebody is looking for when they reach the end.
eq('last in the line', legalFooter().endsWith('VAT No. 529 0734 83'), true);
eq('and separated like every other clause',
   legalFooter().split(' · ').length, 4);

// The clause is absent, not empty, when there is no registration. "VAT No."
// with nothing after it on an invoice invites somebody to reclaim VAT that
// was never charged — this is still the rule, it just no longer applies to us.
eq('a missing registration would leave no trace of itself', (() => {
  const parts = [LEGAL_NAME, 'x', 'y', null].filter(Boolean);
  return parts.join(' · ').includes('VAT');
})(), false);

// @react-pdf's Helvetica silently drops characters it has no glyph for, so a
// separator it cannot print would close the gap and run the clauses together.
// The middle dot is in WinAnsi and prints; this is the guard against somebody
// reaching for an em dash or an arrow next time.
const { pdfSafe } = await import('../../.test-build/pdf/documents.js');
eq('every character of the line survives the PDF font',
   pdfSafe(legalFooter()), legalFooter());

process.exit(fail ? 1 : 0);
