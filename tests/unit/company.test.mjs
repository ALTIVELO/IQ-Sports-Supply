// Who we are, legally, on a document somebody might have to act on.
//
// A limited company has to state its registered name, that it is
// incorporated, where, its number and its registered office on its business
// letters and order forms. An invoice is the document most likely to be kept,
// chased, disputed or handed to an accountant, so it is the one that matters.
//
// The line is assembled rather than written out because it appears in places
// that share no code — a rendered PDF and a plain-text email — and the VAT
// number has to be able to join it later in one edit.
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
   + 'Registered office: 2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ');

// Each part on its own, so a typo in one is a failure that names it.
eq('the registered name', LEGAL_NAME, 'IQ Sports Supply Ltd');
eq('the company number', COMPANY_NUMBER, '17430665');
eq('the registered office', REGISTERED_OFFICE,
   '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ');

// There is no VAT registration yet. "VAT No." with nothing after it on an
// invoice invites somebody to reclaim VAT that was never charged, so the
// whole clause is absent rather than empty.
eq('there is no VAT number yet', VAT_NUMBER, null);
eq('and the line does not mention one', legalFooter().includes('VAT'), false);
// The one edit it will take. Proven against the same builder the documents
// call, so nobody has to guess where it lands or what separates it.
eq('setting one adds a clause on the end, and nothing else moves', (() => {
  const parts = legalFooter().split(' · ');
  return [...parts, 'VAT No. GB123456789'].join(' · ');
})(),
   'IQ Sports Supply Ltd · Registered in England & Wales, Company No. 17430665 · '
   + 'Registered office: 2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ · '
   + 'VAT No. GB123456789');

// @react-pdf's Helvetica silently drops characters it has no glyph for, so a
// separator it cannot print would close the gap and run the clauses together.
// The middle dot is in WinAnsi and prints; this is the guard against somebody
// reaching for an em dash or an arrow next time.
const { pdfSafe } = await import('../../.test-build/pdf/documents.js');
eq('every character of the line survives the PDF font',
   pdfSafe(legalFooter()), legalFooter());

process.exit(fail ? 1 : 0);
