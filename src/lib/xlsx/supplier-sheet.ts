import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

/**
 * The Madison order sheet.
 *
 * James sends Madison their own order form rather than our paperwork, so the
 * app fills a copy of the form instead of drawing one: templates/madison-order.xlsx,
 * whose "App mapping" tab records which cell each field goes in. The template
 * is the thing to edit — the account number, the contact, the footer wording —
 * and this module only fills it in.
 *
 * It is addressed to the supplier but it never goes to the supplier. It goes
 * to James, who reads it and forwards it himself. That is the whole reason the
 * sheet is built the way it is: it carries no price of any kind and nothing
 * that identifies the customer, so a forward cannot leak either, and the one
 * client reference on it is the SO number the supplier is asked to quote back.
 */

/**
 * Hard-coded, deliberately. There is a configurable supplier address in
 * settings (supplier_recipient) and this must never read it: a sheet that
 * reached Madison direct would hand them our order book, and a settings field
 * is one mistyped line away from doing exactly that.
 */
export const SHEET_RECIPIENT = 'james@iqsportsupply.com';

/** Where the form lives. Named in next.config.ts so Vercel deploys it. */
export const TEMPLATE_PATH = path.join(process.cwd(), 'templates', 'madison-order.xlsx');

/** The sheet the app fills. Every other tab is dropped from what it sends. */
const SHEET_NAME = 'Order';

/** Column A, found by its label, is what anchors the whole layout. */
const HEADER_LABEL = 'Line';
const TOTAL_LABEL = 'Total units';

/** Everything the sheet is allowed to say. */
export interface SupplierSheetData {
  /** IQ-PO-001 — ours, not the supplier's. */
  reference: string;
  /** ISO yyyy-mm-dd. Written as a real date so the form's format applies. */
  date: string;
  /** The SO numbers this order covers, in the order they should be read. */
  clientRefs: string[];
  /** Fulfilment site name and address: where Madison delivers. */
  site: string;
  siteAddress: string | null;
  requiredBy: string | null;
  lines: { sku: string; name: string; qty: number; clientRef: string | null }[];
}

/**
 * What the app knows about a purchase order, which is more than the supplier
 * may see.
 *
 * The sensitive fields are in the type on purpose. This function is the only
 * place that decides what reaches the sheet, so the way to prove it keeps a
 * price or a customer name out is to hand it one and look at what comes back —
 * which is what tests/unit/supplier-sheet.test.mjs does. A whitelist that is
 * never shown a secret proves nothing.
 */
export interface SupplierSheetSource {
  /**
   * The purchase orders the sheet covers. Usually one. Several when James
   * sends Madison a morning's worth of orders as one order: the supplier
   * would rather pick one list than five, and every line carries the SO it
   * is for either way.
   */
  pos: { number: string }[];
  date: string;
  lines: {
    sku: string; name: string; qty: number; so_reference?: string | null;
    [ignored: string]: unknown;
  }[];
  location: { name: string; address?: string | null } | null;
  requiredBy?: string | null;
  [ignored: string]: unknown;
}

const ours = (poNumber: string) => (/^IQ-/i.test(poNumber) ? poNumber : `IQ-${poNumber}`);

/**
 * IQ-PO-001 from PO-001: ours is the same number, said as ours. Several of
 * them read as a list, which is what the supplier is being asked to quote
 * back on the delivery note.
 */
export function sheetReference(poNumbers: string[]): string {
  if (poNumbers.length === 0) throw new Error('A supplier sheet needs a purchase order behind it');
  return poNumbers.map(ours).join(', ');
}

/**
 * IQ-PO-001.xlsx, or IQ-PO-001-002-003.xlsx for several — the later numbers
 * without the prefix they all share, because a filename is read at a glance.
 * Past a handful it is counted instead of listed. No client reference in it:
 * it is a filename, and filenames get forwarded, quoted and filed.
 */
export function sheetFilename(poNumbers: string[]): string {
  const [first, ...rest] = poNumbers;
  const head = sheetReference([first]);
  const base = rest.length === 0 ? head
    : rest.length <= 3 ? [head, ...rest.map((n) => n.replace(/^(IQ-)?PO-/i, ''))].join('-')
    : `${head}-and-${rest.length}-more`;
  return `${base.replace(/[^A-Za-z0-9._-]+/g, '-')}.xlsx`;
}

/**
 * The whitelist. Four fields per line, and nothing from anywhere else in the
 * source object, however it grows.
 */
export function supplierSheetData(src: SupplierSheetSource): SupplierSheetData {
  const lines = src.lines.map((l) => ({
    sku: String(l.sku),
    name: String(l.name),
    qty: Number(l.qty),
    clientRef: l.so_reference ? String(l.so_reference) : null,
  }));

  const refs: string[] = [];
  for (const l of lines) if (l.clientRef && !refs.includes(l.clientRef)) refs.push(l.clientRef);
  refs.sort((a, b) => a.localeCompare(b));

  return {
    reference: sheetReference(src.pos.map((p) => p.number)),
    date: src.date,
    clientRefs: refs,
    site: src.location?.name ?? '',
    siteAddress: src.location?.address ?? null,
    requiredBy: src.requiredBy ?? null,
    lines,
  };
}

/** yyyy-mm-dd as a UTC date, so the serial Excel stores is the day we meant. */
function excelDate(iso: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function labelRow(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (typeof v === 'string' && v.trim() === label) return r;
  }
  throw new Error(`templates/madison-order.xlsx: no "${label}" row in sheet "${SHEET_NAME}"`);
}

/**
 * Fills the form and returns the .xlsx.
 *
 * `template` is for tests; production reads the committed file.
 */
export async function buildSupplierSheet(
  data: SupplierSheetData, template?: Uint8Array,
): Promise<Uint8Array> {
  const bytes = template ?? await readFile(TEMPLATE_PATH);

  const wb = new ExcelJS.Workbook();
  // ExcelJS declares a global `interface Buffer extends ArrayBuffer`, which
  // merges with Node's and leaves nothing actually assignable to it. The
  // runtime takes a Uint8Array; only the declaration disagrees.
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`templates/madison-order.xlsx: no sheet named "${SHEET_NAME}"`);

  // The mapping tab is a note to ourselves about how this code works. It is
  // not part of an order, so it does not go out with one.
  for (const other of wb.worksheets.filter((w) => w.name !== SHEET_NAME)) {
    wb.removeWorksheet(other.id);
  }

  // Whoever generated it is the company, not a machine or a person.
  wb.creator = 'IQ Sports Supply';
  wb.lastModifiedBy = 'IQ Sports Supply';

  const headerRow = labelRow(ws, HEADER_LABEL);
  let totalRow = labelRow(ws, TOTAL_LABEL);
  const firstLine = headerRow + 1;
  let lastLine = totalRow - 1;

  // The form has room for fifty; an order can have more. Copying the last
  // line row gives the new rows its borders and its banding, and the formulas
  // that depend on where a row sits are rewritten below regardless.
  const extra = data.lines.length - (lastLine - firstLine + 1);
  if (extra > 0) {
    ws.duplicateRow(lastLine, extra, true);
    lastLine += extra;
    totalRow += extra;
  }

  // Header fields, per the mapping tab. The Madison account number (C8) is
  // filled in once in the template and left alone here.
  ws.getCell(`C${headerRow - 6}`).value = data.reference;                 // C5
  ws.getCell(`C${headerRow - 5}`).value = excelDate(data.date);           // C6
  ws.getCell(`C${headerRow - 4}`).value = data.clientRefs.join(', ');     // C7
  ws.getCell(`C${headerRow - 2}`).value = data.requiredBy || null;        // C9
  ws.getCell(`F${headerRow - 3}`).value = data.site || null;              // F8
  ws.getCell(`F${headerRow - 2}`).value = data.siteAddress || null;       // F9

  /*
   * A clean line row to copy from. The template ships an example row in the
   * first slot, greyed and italic to say "delete me", and a real line written
   * into it would inherit that. The row below it is the plain one, so the
   * banding is read off the rows themselves rather than assumed.
   */
  const plain = (row: number) => {
    const ref = firstLine + ((row - firstLine) % 2 === 0 ? 2 : 1);
    return ref <= lastLine ? ref : row;
  };

  for (let r = firstLine; r <= lastLine; r++) {
    const line = data.lines[r - firstLine];
    const ref = ws.getRow(plain(r));
    for (let c = 2; c <= 6; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.style = { ...ref.getCell(c).style };
      cell.value = null;
    }
    // Line numbers are the template's own formula, rewritten for the row it
    // now sits on — duplicated rows carry a copy that points at the original.
    ws.getRow(r).getCell(1).value = { formula: `IF(B${r}="","",ROW()-${headerRow})` };
    if (!line) continue;
    ws.getRow(r).getCell(2).value = line.sku;
    ws.getRow(r).getCell(3).value = line.name;
    ws.getRow(r).getCell(4).value = line.qty;
    ws.getRow(r).getCell(5).value = line.clientRef;
  }

  // Totals are the template's formulas too, over however many rows there are.
  ws.getCell(`D${totalRow}`).value = { formula: `SUM(D${firstLine}:D${lastLine})` };
  ws.getCell(`E${totalRow}`).value = {
    formula: `COUNTA(B${firstLine}:B${lastLine})&" lines"`,
  };

  // Rows were inserted above it, so the printed page has to be told.
  if (extra > 0 && ws.pageSetup?.printArea) {
    ws.pageSetup.printArea = ws.pageSetup.printArea.replace(
      /^(\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?)(\d+)$/,
      (_m, head: string, last: string) => `${head}${Number(last) + extra}`);
  }

  return new Uint8Array(await wb.xlsx.writeBuffer() as unknown as ArrayBuffer);
}
