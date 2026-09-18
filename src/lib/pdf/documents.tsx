import React from 'react';
import { Document, Page, Text as PdfText, View, StyleSheet } from '@react-pdf/renderer';
import { fmtDate, money, totals } from '@/lib/format';
import { agencyHeading, agencyLines } from '@/lib/orders/agency';

/*
 * Characters the built-in PDF fonts cannot print.
 *
 * @react-pdf ships the fourteen standard PDF fonts, and Helvetica among them
 * has no glyph for the euro sign, the dashes, the curly quotes or an
 * ellipsis. It does not complain about any of them: it drops the character
 * and closes the gap, so "€1,450.00" prints as "1,450.00" — a figure on an
 * invoice with no currency against it — and "help with it — tell us" prints
 * as "help with it  tell us".
 *
 * Every string this document prints therefore goes through here. Registering
 * a font with the missing glyphs would be the other answer, but that means a
 * font file fetched at render time, and an invoice that fails to build
 * because a CDN is slow is a worse invoice than one that says EUR.
 */
const SUBSTITUTIONS: [RegExp, string][] = [
  [/€\s?/g, 'EUR '],
  [/[\u2014\u2013]/g, '-'],   // em and en dash
  [/[\u2018\u2019]/g, "'"],   // curly single quotes
  [/[\u201C\u201D]/g, '"'],   // curly double quotes
  [/\u2026/g, '...'],
  [/\u2192/g, '->'],
  [/\u00a0/g, ' '],           // non-breaking space, which does not wrap
];

export function pdfSafe(text: string): string {
  return SUBSTITUTIONS.reduce((acc, [from, to]) => acc.replace(from, to), text);
}

/**
 * Every piece of text on these documents, with the unprintable characters
 * swapped out.
 *
 * Wrapping the component rather than each call site means a line added to
 * this file later cannot reintroduce the problem, and nobody has to know the
 * rule to keep it.
 */
function clean(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return pdfSafe(node);
  if (Array.isArray(node)) return node.map(clean);
  return node;
}

type TextProps = React.ComponentProps<typeof PdfText> & { children?: React.ReactNode };

function Text({ children, ...rest }: TextProps) {
  return <PdfText {...rest}>{clean(children)}</PdfText>;
}

const INK = '#121619';
const FLAME = '#C2340C';  // the darkened brand orange, legible on paper
const LINE = '#E1E4E8';
const MUTE = '#5A6470';

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  ref: { fontSize: 9, marginTop: 3, color: MUTE },
  company: { textAlign: 'right', maxWidth: 200, fontSize: 8, color: MUTE },
  companyName: { fontFamily: 'Helvetica-Bold', color: INK, fontSize: 9, marginBottom: 2 },
  parties: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, marginBottom: 18 },
  label: { fontSize: 7, color: MUTE, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  strong: { fontFamily: 'Helvetica-Bold' },
  addr: { maxWidth: 220 },
  tHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 4, marginBottom: 2 },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EDEFF2', paddingVertical: 5 },
  th: { fontSize: 7, color: MUTE, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  cSku: { width: 90 }, cName: { flex: 1, paddingRight: 8 },
  cQty: { width: 40, textAlign: 'right', paddingRight: 8 },
  cUnit: { width: 60, textAlign: 'right' },
  cLine: { width: 70, textAlign: 'right' },
  cBox: { width: 46, alignItems: 'center' },
  totals: { marginTop: 14, alignItems: 'flex-end' },
  totRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', paddingVertical: 2 },
  grand: { flexDirection: 'row', width: 200, justifyContent: 'space-between',
           borderTopWidth: 1, borderTopColor: LINE, marginTop: 4, paddingTop: 6 },
  grandText: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7,
            color: MUTE, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  badge: { color: FLAME, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  agency: { borderWidth: 1, borderColor: FLAME, padding: 10, marginBottom: 16 },
  agencyHead: { fontFamily: 'Helvetica-Bold', fontSize: 8, textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 5 },
  agencyLine: { fontSize: 8, lineHeight: 1.5, marginTop: 2 },
  box: { width: 10, height: 10, borderWidth: 1, borderColor: '#B9C4CE' },
});

export interface DocLine { sku: string; name: string; qty: number; unit_price: number }

export interface DocData {
  invoiceNumber: string;
  orderNumber: string;
  type: 'full' | 'shipment' | 'backorder' | 'proforma' | 'credit';
  /** Why a credit note was raised, or that a proforma asks for nothing. */
  note?: string | null;
  date: string;
  dueDate: string;
  vatRate: number;
  /** The money this invoice demands. Taken from the order, never converted. */
  currency?: string;
  /**
   * What the prices on this invoice do not include, where any line says so.
   *
   * Import duty is the case this exists for: it is levied on the buyer, after
   * this document, and by somebody else. A price that quietly excludes it is
   * a price the customer will later find was not the price.
   */
  priceNotes?: string[];
  /**
   * Where we introduced this order rather than sold it.
   *
   * The brand confirms it, raises the final invoice with shipping and taxes,
   * and carries the warranty and product liability; we are paid a commission
   * for the introduction. A customer holding a document with our letterhead
   * on it will otherwise assume all of that is ours.
   */
  agencyTerms?: string | null;
  agentBrand?: string | null;
  lines: DocLine[];
  clientName: string;
  /** Billing address: the legal invoicing address where one is given. */
  clientAddress: string | null;
  /** Where this order is actually going, as it was when the order was placed. */
  shipTo: string | null;
  clientVatNo: string | null;
  company: string;
  companyAddress: string;
  paid: boolean;
  locationName?: string | null;
}

/** Whether we are the seller on this document, or only the introducer. */
const isAgency = (d: DocData) => Boolean(d.agencyTerms && d.type !== 'credit');

const typeLabel = (t: DocData['type']) =>
  t === 'backorder' ? 'back-order shipment' : t === 'shipment' ? 'part shipment' : null;

/**
 * What the document calls itself.
 *
 * A credit note printed under the word Invoice would be read as a demand for
 * the money it is refunding, so the type decides the heading rather than the
 * route that rendered it.
 */
const documentTitle = (d: DocData) =>
  d.type === 'credit' ? 'Credit note'
    : d.type === 'proforma' ? 'Proforma'
      // On an order we introduced, the final invoice is the brand's, with
      // shipping and taxes on it. Printing the word Invoice over our
      // letterhead would say we are the seller, which is the one thing this
      // document has to get right.
      : isAgency(d) ? 'Order confirmation'
        : 'Invoice';

function Header({ d, title }: { d: DocData; title: string }) {
  const sub = typeLabel(d.type);
  return (
    <View style={s.header}>
      <View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.ref}>
          {d.invoiceNumber} · order {d.orderNumber}{sub ? ` · ${sub}` : ''}
        </Text>
      </View>
      <View style={s.company}>
        <Text style={s.companyName}>{d.company}</Text>
        <Text>{d.companyAddress}</Text>
      </View>
    </View>
  );
}

/**
 * Who is selling, on a document with our letterhead at the top of it.
 *
 * Above the goods rather than under the total, because it changes how every
 * figure below it should be read: those prices are the brand's ex-works
 * prices, the shipping and the taxes are not on this page, and the final
 * invoice is somebody else's document.
 */
function AgencyBlock({ d }: { d: DocData }) {
  if (!isAgency(d)) return null;
  const names = { brand: d.agentBrand || 'the brand', company: d.company };
  const lines = agencyLines(d.agencyTerms, names);
  if (!lines.length) return null;

  return (
    <View style={s.agency} wrap={false}>
      <Text style={s.agencyHead}>{agencyHeading(names)}</Text>
      {lines.map((line) => (
        <Text key={line} style={s.agencyLine}>{line}</Text>
      ))}
    </View>
  );
}

export function InvoiceDocument({ d }: { d: DocData }) {
  const { net, vat, gross } = totals(d.lines, d.vatRate);
  return (
    <Document title={`${documentTitle(d)} ${d.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <Header d={d} title={documentTitle(d)} />

        <View style={s.parties}>
          <View>
            <Text style={s.label}>{isAgency(d) ? 'Ordered by' : 'Bill to'}</Text>
            <Text style={s.strong}>{d.clientName}</Text>
            {d.clientAddress ? <Text style={s.addr}>{d.clientAddress}</Text> : null}
            {d.clientVatNo ? <Text style={{ color: MUTE, marginTop: 3 }}>VAT {d.clientVatNo}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>Date</Text>
            <Text style={s.strong}>{fmtDate(d.date)}</Text>
            {/* Nothing is due to us on an introduced order, so no date that
                looks like a demand is printed on it. */}
            {d.type === 'proforma' || d.type === 'credit' || isAgency(d) ? null : (
              <>
                <Text style={[s.label, { marginTop: 8 }]}>Payment due</Text>
                <Text style={s.strong}>{fmtDate(d.dueDate)}</Text>
                {d.paid ? <Text style={[s.badge, { marginTop: 8 }]}>PAID</Text> : null}
              </>
            )}
          </View>
        </View>

        <AgencyBlock d={d} />

        <View style={s.tHead}>
          <Text style={[s.th, s.cSku]}>SKU</Text>
          <Text style={[s.th, s.cName]}>Item</Text>
          <Text style={[s.th, s.cQty]}>Qty</Text>
          <Text style={[s.th, s.cUnit]}>Unit</Text>
          <Text style={[s.th, s.cLine]}>Line</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.tRow} wrap={false}>
            <Text style={s.cSku}>{l.sku}</Text>
            <Text style={s.cName}>{l.name}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cUnit}>{money(l.unit_price, d.currency)}</Text>
            <Text style={s.cLine}>{money(l.qty * Number(l.unit_price), d.currency)}</Text>
          </View>
        ))}

        {/* On an introduced order the only figure we can state is what the
            goods come to. Shipping and tax are added by the brand on their
            own invoice, so a VAT line and a grand total here would be two
            numbers the customer does not owe anybody. */}
        {isAgency(d) ? (
          <View style={s.totals}>
            <View style={s.grand}>
              <Text style={s.grandText}>Goods</Text>
              <Text style={s.grandText}>{money(net, d.currency)}</Text>
            </View>
            <Text style={[s.totRow, { color: MUTE, fontSize: 8 }]}>
              Before shipping and taxes, which {d.agentBrand ?? 'the brand'} adds
              on their invoice
            </Text>
          </View>
        ) : (
          <View style={s.totals}>
            <View style={s.totRow}><Text>Net</Text><Text>{money(net, d.currency)}</Text></View>
            <View style={s.totRow}>
              <Text>VAT {Number(d.vatRate)}%</Text><Text>{money(vat, d.currency)}</Text>
            </View>
            <View style={s.grand}>
              <Text style={s.grandText}>Total</Text>
              <Text style={s.grandText}>{money(gross, d.currency)}</Text>
            </View>
          </View>
        )}

        {d.note ? <Text style={{ marginTop: 10, color: MUTE }}>{d.note}</Text> : null}

        {(d.priceNotes ?? []).map((note) => (
          <Text key={note} style={{ marginTop: 6, color: MUTE }}>{note}</Text>
        ))}

        <Text style={s.footer} fixed>
          {d.company} · {d.companyAddress}
          {d.type === 'proforma'
            ? ' · Proforma — no payment is due on this document'
            : d.type === 'credit'
              ? ' · Credit note — this amount is owed to you, not by you'
              : isAgency(d)
                ? ` · No payment is due on this document — ${
                    d.agentBrand ?? 'the brand'} raises the final invoice`
                : ` · Payment due ${fmtDate(d.dueDate)}`}
          {Number(d.vatRate) === 0 ? ' · Zero-rated supply' : ''}
        </Text>
      </Page>
    </Document>
  );
}

export function PackingListDocument({ d }: { d: DocData }) {
  return (
    <Document title={`Packing list ${d.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <Header d={d} title="Packing list" />

        <View style={s.parties}>
          <View>
            <Text style={s.label}>Deliver to</Text>
            <Text style={s.strong}>{d.clientName}</Text>
            {d.shipTo ? <Text style={s.addr}>{d.shipTo}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>Pack at</Text>
            <Text style={s.strong}>{d.locationName ?? '—'}</Text>
            <Text style={[s.label, { marginTop: 8 }]}>Date</Text>
            <Text style={s.strong}>{fmtDate(d.date)}</Text>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={[s.th, s.cSku]}>SKU</Text>
          <Text style={[s.th, s.cName]}>Item</Text>
          <Text style={[s.th, s.cQty]}>Qty</Text>
          <Text style={[s.th, s.cBox]}>Packed</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.tRow} wrap={false}>
            <Text style={s.cSku}>{l.sku}</Text>
            <Text style={s.cName}>{l.name}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <View style={s.cBox}><View style={s.box} /></View>
          </View>
        ))}

        <View style={{ marginTop: 30, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: MUTE }}>Packed by ______________________</Text>
          <Text style={{ color: MUTE }}>Checked by ______________________</Text>
        </View>

        <Text style={s.footer} fixed>
          {d.company} · Packing list for invoice {d.invoiceNumber} · no prices shown
        </Text>
      </Page>
    </Document>
  );
}
