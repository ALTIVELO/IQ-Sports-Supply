// A supplier price list is a printed document: a title, section headings, and
// the column headers repeated under each one. None are products, and none
// should be reported as bad rows either — a real sheet has dozens.
const { isStructuralRow } = await import('../../.test-build/import/parse.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${ok ? '' : `  (got ${got}, wanted ${want})`}`);
};
const HEADER = ['CODE', 'DESCRIPTION', 'PRICE'];

check('a section heading alone on its row is skipped',
  isStructuralRow({ sku: 'BOTTOM BRACKETS', name: '', price: '' }, HEADER), true);
check('so is the sheet title',
  isStructuralRow({ sku: 'JMM — Distributor to Distributor Price List ex vat', name: '', price: '' }, HEADER), true);
check('and the column headers repeated under it',
  isStructuralRow({ sku: 'CODE', name: 'DESCRIPTION', price: 'PRICE' }, HEADER), true);
check('matched whatever the case',
  isStructuralRow({ sku: 'code', name: 'Description', price: 'price' }, HEADER), true);
check('an entirely blank row is skipped',
  isStructuralRow({ sku: '', name: '', price: '' }, HEADER), true);

check('a real product is kept',
  isStructuralRow({ sku: 'R9270DLR', name: 'STI LVR STR9270 Di2', price: '204.34' }, HEADER), false);
check('and so is one the supplier left undescribed',
  isStructuralRow({ sku: 'BBUN300B07', name: '', price: '5.71' }, HEADER), false);
check('and a bundle row that carries no part code',
  isStructuralRow({ sku: '', name: 'Dura-Ace R9200 Standard Build', price: '1209.87' }, HEADER), false);

// The trap: a priced row with one populated cell must not look like a heading.
check('a lone price is not treated as a heading',
  isStructuralRow({ sku: '', name: '', price: '12.50' }, HEADER), false);
// And a product whose name happens to equal one header word is still a product.
check('a product named like a single header word is kept',
  isStructuralRow({ sku: 'CODE-1', name: 'Description', price: '9.99' }, HEADER), false);

console.log(fail ? `\n${fail} failed` : '');
process.exit(fail ? 1 : 0);
