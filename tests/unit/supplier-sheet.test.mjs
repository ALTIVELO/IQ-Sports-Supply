// The Madison order sheet: the one document we generate that is written for
// somebody outside the business to read.
//
// Everything else we produce is for the customer, so it names them and prices
// their goods. This one is the opposite, and the opposite is easy to get wrong
// by accident: the data it is built from — the order, the lines, the client —
// carries all of it, and a field added to a query a year from now arrives on
// the sheet for free unless something stops it.
//
// So the fixture here is deliberately dirty. The purchase order it is built
// from carries a client, an address, an email and a price on every line, and
// the test is that none of it reaches the file, the filename or the covering
// email. A whitelist that is only ever shown clean data proves nothing about
// what it does with dirty data.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const {
  SHEET_RECIPIENT, buildSupplierSheet, sheetFilename, sheetReference, supplierSheetData,
} = await import('../../.test-build/xlsx/supplier-sheet.js');
const { supplierSheet } = await import('../../.test-build/email/templates.js');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${cond ? '' : ` — ${extra}`}`);
};

// ── reading the .xlsx as what it is: a zip of XML ───────────────────────────
//
// Cell by cell through a spreadsheet library would miss the places a leak is
// most likely to hide — document properties, a defined name, a leftover sheet,
// a cached formula result. Everything in the archive is read instead.
function unzipText(buf) {
  const b = Buffer.from(buf);
  let eocd = b.length - 22;
  while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  let n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = {};
  while (n--) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lho = b.readUInt32LE(p + 42);
    const dataAt = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    const raw = b.subarray(dataAt, dataAt + size);
    out[name] = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ── the fixture, with everything on it that must not come out ───────────────
const CLIENT = {
  name: 'Velo Barn Cycles Ltd',
  contact: 'Priya Raman',
  email: 'priya@velobarn.example',
  address: '14 Mill Lane, Bristol BS1 4QR',
};
const PRICES = ['129.99', '87.50', '64.25', '1559.88', '£129.99', '1,559.88'];

const dirtyLines = [
  { sku: 'ISMRT800SS', name: 'Shimano RT-MT800 rotor 160mm', qty: 12,
    so_reference: 'SO-018', unit_price: 129.99, cost_price: 87.50,
    client_name: CLIENT.name, line_total: 1559.88 },
  { sku: 'EWSD300L120', name: 'Shimano EW-SD300 wire 1200mm', qty: 4,
    so_reference: 'SO-019', unit_price: 64.25, cost_price: 41.10,
    client_name: CLIENT.name },
];

const source = {
  po: { number: 'PO-042', date: '2026-11-05' },
  lines: dirtyLines,
  location: { name: 'Slough', address: '2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ' },
  // Everything the app knows about the order, handed over whole.
  client: CLIENT,
  order: { number: 'SO-018', total: 1559.88, client_name: CLIENT.name },
};

const data = supplierSheetData(source);
const template = readFileSync(new URL('../../templates/madison-order.xlsx', import.meta.url));
const file = await buildSupplierSheet(data, template);
const entries = unzipText(file);
const whole = Object.values(entries).join('\n');

const filename = sheetFilename(source.po.number);
const email = supplierSheet({
  company: 'IQ Sports Supply', reference: data.reference, filename, date: data.date,
  site: data.site, clientRefs: data.clientRefs,
  lineCount: data.lines.length,
  totalUnits: data.lines.reduce((n, l) => n + l.qty, 0),
});
const emailText = `${email.subject}\n${email.body}`;

// ── the rule the whole feature exists for ───────────────────────────────────
for (const [what, value] of Object.entries(CLIENT)) {
  ok(`the sheet does not carry the customer's ${what}`, !whole.includes(value), value);
  ok(`the filename does not carry the customer's ${what}`, !filename.includes(value), filename);
  ok(`the email does not carry the customer's ${what}`, !emailText.includes(value), value);
}
// Separately from the full address, because a leak of one line of it is a leak.
for (const part of ['14 Mill Lane', 'Bristol', 'BS1 4QR', 'Velo Barn']) {
  ok(`"${part}" is nowhere in the sheet`, !whole.includes(part));
  ok(`"${part}" is nowhere in the email`, !emailText.includes(part));
}
for (const price of PRICES) {
  ok(`the sheet does not price anything (${price})`, !whole.includes(price), price);
  ok(`the email does not price anything (${price})`, !emailText.includes(price), price);
}
// The numbers themselves, not just how they were typed: 129.99 could be
// written into a cell as a number and would then appear without its decimals
// only if it were rounded, which would still be a price.
for (const n of [129.99, 87.5, 64.25, 1559.88, 41.1]) {
  ok(`no cell holds ${n}`, !new RegExp(`>${n}<`).test(whole));
}

// ── and what it must carry, or James has nothing to forward ─────────────────
ok('the PO is referenced as ours', data.reference === 'IQ-PO-042', data.reference);
ok('the filename is the reference', filename === 'IQ-PO-042.xlsx', filename);
ok('the reference is left alone if it is already ours',
  sheetReference('IQ-PO-042') === 'IQ-PO-042');
for (const l of dirtyLines) {
  ok(`${l.sku} is on the sheet`, whole.includes(l.sku));
  ok(`${l.name} is on the sheet`, whole.includes(l.name));
}
ok('both SO references are on it', data.clientRefs.join(',') === 'SO-018,SO-019',
  data.clientRefs.join(','));
ok('the SO reference is allowed on the sheet', whole.includes('SO-018'));
ok('and in the email, which is how James knows what it is',
  emailText.includes('SO-018') && emailText.includes('SO-019'));
ok('the delivery site is on it', whole.includes('Slough'));

// ── it goes to James, and the address is not configurable ───────────────────
ok('the sheet is addressed to James', SHEET_RECIPIENT === 'james@iqsportsupply.com',
  SHEET_RECIPIENT);
ok('the email is the covering note and nothing more',
  email.body.split('\n').filter((l) => l.trim()).length <= 8, email.body);

// ── the file itself ─────────────────────────────────────────────────────────
ok('only the order sheet goes out', Object.keys(entries)
  .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length === 1,
  Object.keys(entries).join(' '));
ok('the mapping tab does not', !/App mapping/i.test(whole));
ok("the template's example row does not", !whole.includes('Example row'));
ok('nothing in it is attributed to a person', !/<dc:creator>(?!IQ Sports Supply<)/.test(whole));

// ── the mapping tab is the contract, not a comment ──────────────────────────
//
// The template's second tab records which cell each field goes in, and it is
// the thing James reads when he changes the form. Reading it back here means
// a field that moves on the form and in the tab shows up as a failing test
// rather than as an order Madison cannot read.
const ExcelJS = (await import('exceljs')).default;

const tpl = new ExcelJS.Workbook();
await tpl.xlsx.load(template);
const mapTab = tpl.getWorksheet('App mapping');
ok('the template still carries its mapping tab', Boolean(mapTab));

const mapped = {};
for (let r = 1; r <= (mapTab?.rowCount ?? 0); r++) {
  const field = mapTab.getRow(r).getCell(1).value;
  const cell = mapTab.getRow(r).getCell(2).value;
  if (typeof field === 'string' && typeof cell === 'string' && /^[A-Z]+\d/.test(cell)) {
    mapped[field.trim()] = cell.trim();
  }
}

const built = new ExcelJS.Workbook();
await built.xlsx.load(file);
const order = built.getWorksheet('Order');
const at = (field) => order.getCell(mapped[field].split(':')[0]).value;

ok('the PO number is where the tab says', at('PO number') === 'IQ-PO-042',
  `${mapped['PO number']} = ${JSON.stringify(at('PO number'))}`);
ok('the client ref is where the tab says', at('Client order ref') === 'SO-018, SO-019',
  JSON.stringify(at('Client order ref')));
ok('the site is where the tab says', at('Deliver to (site)') === 'Slough',
  JSON.stringify(at('Deliver to (site)')));
ok('the delivery address is where the tab says',
  String(at('Delivery address')).startsWith('2 Carnegie Court'),
  JSON.stringify(at('Delivery address')));

// A real date, not the string we were handed: the form formats the cell
// dd/mm/yyyy, and a text cell would print whatever we typed instead.
const dateCell = order.getCell(mapped['Order date']);
ok('the order date is a date', dateCell.value instanceof Date, typeof dateCell.value);
ok('and it is the right day',
  dateCell.value instanceof Date && dateCell.value.toISOString().startsWith('2026-11-05'),
  String(dateCell.value));
ok('left formatted as the form formats it', dateCell.numFmt === 'dd/mm/yyyy', dateCell.numFmt);

// Filled in once on the template and never touched by the app.
ok('the Madison account number is left as the template has it',
  order.getCell(mapped['Madison account no.']).value
    === tpl.getWorksheet('Order').getCell(mapped['Madison account no.']).value);

const firstLine = Number(mapped['Line items'].match(/\d+/)[0]);
ok('the first line is where the tab says',
  order.getRow(firstLine).getCell(2).value === 'ISMRT800SS',
  JSON.stringify(order.getRow(firstLine).getCell(2).value));
ok('with its description and quantity beside it',
  order.getRow(firstLine).getCell(3).value === 'Shimano RT-MT800 rotor 160mm'
  && order.getRow(firstLine).getCell(4).value === 12);
ok('and the SO reference it is for',
  order.getRow(firstLine).getCell(5).value === 'SO-018');
ok('the line number is the template\'s formula, not a number we wrote',
  typeof order.getRow(firstLine).getCell(1).value?.formula === 'string');
ok('the total is the template\'s formula too',
  typeof order.getCell(mapped['Total units']).value?.formula === 'string');

// ── more lines than the form has rows ───────────────────────────────────────
//
// The form holds fifty. A big order has more, and the alternative to growing
// the table is a sheet that silently stops at line fifty — which is an order
// placed with a supplier for less than the customer bought.
const many = Array.from({ length: 60 }, (_, i) => ({
  sku: `BIG${String(i + 1).padStart(3, '0')}`,
  name: `Line number ${i + 1}`, qty: i + 1, so_reference: 'SO-020',
  unit_price: 99.99,
}));
const bigFile = await buildSupplierSheet(
  supplierSheetData({ ...source, lines: many }), template);
const big = new ExcelJS.Workbook();
await big.xlsx.load(bigFile);
const bigSheet = big.getWorksheet('Order');
let totalRow = 0;
for (let r = 1; r <= bigSheet.rowCount; r++) {
  if (bigSheet.getRow(r).getCell(1).value === 'Total units') totalRow = r;
}
ok('the table grew for a sixty-line order', totalRow === firstLine + 60, String(totalRow));
ok('the last line is on it',
  bigSheet.getRow(totalRow - 1).getCell(2).value === 'BIG060',
  JSON.stringify(bigSheet.getRow(totalRow - 1).getCell(2).value));
ok('the total covers every row of it',
  bigSheet.getCell(`D${totalRow}`).value?.formula === `SUM(D${firstLine}:D${totalRow - 1})`,
  JSON.stringify(bigSheet.getCell(`D${totalRow}`).value));
ok('the line numbers follow the rows they ended up on',
  bigSheet.getRow(totalRow - 1).getCell(1).value?.formula
    === `IF(B${totalRow - 1}="","",ROW()-${firstLine - 1})`,
  JSON.stringify(bigSheet.getRow(totalRow - 1).getCell(1).value));
ok('the footer moved down with it',
  /Please quote the PO number/.test(String(bigSheet.getCell(`A${totalRow + 2}`).value)),
  JSON.stringify(bigSheet.getCell(`A${totalRow + 2}`).value));
ok('and the printed page was told', bigSheet.pageSetup.printArea === `A1:F${totalRow + 2}`,
  bigSheet.pageSetup.printArea);
ok('a sixty-line sheet prices nothing either',
  !Object.values(unzipText(bigFile)).join('').includes('99.99'));

if (fail) process.exitCode = 1;
