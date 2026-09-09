import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { fmtDate, money, totals } from '@/lib/format';

const INK = '#16222E';
const COBALT = '#2242C8';
const LINE = '#DCE2E8';
const MUTE = '#5B6B79';

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
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EAEEF2', paddingVertical: 5 },
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
  badge: { color: COBALT, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  box: { width: 10, height: 10, borderWidth: 1, borderColor: '#B9C4CE' },
});

export interface DocLine { sku: string; name: string; qty: number; unit_price: number }

export interface DocData {
  invoiceNumber: string;
  orderNumber: string;
  type: 'full' | 'shipment' | 'backorder';
  date: string;
  dueDate: string;
  vatRate: number;
  lines: DocLine[];
  clientName: string;
  clientAddress: string | null;
  clientVatNo: string | null;
  company: string;
  companyAddress: string;
  paid: boolean;
  locationName?: string | null;
}

const typeLabel = (t: DocData['type']) =>
  t === 'backorder' ? 'back-order shipment' : t === 'shipment' ? 'part shipment' : null;

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

export function InvoiceDocument({ d }: { d: DocData }) {
  const { net, vat, gross } = totals(d.lines, d.vatRate);
  return (
    <Document title={`Invoice ${d.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <Header d={d} title="Invoice" />

        <View style={s.parties}>
          <View>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.strong}>{d.clientName}</Text>
            {d.clientAddress ? <Text style={s.addr}>{d.clientAddress}</Text> : null}
            {d.clientVatNo ? <Text style={{ color: MUTE, marginTop: 3 }}>VAT {d.clientVatNo}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>Invoice date</Text>
            <Text style={s.strong}>{fmtDate(d.date)}</Text>
            <Text style={[s.label, { marginTop: 8 }]}>Payment due</Text>
            <Text style={s.strong}>{fmtDate(d.dueDate)}</Text>
            {d.paid ? <Text style={[s.badge, { marginTop: 8 }]}>PAID</Text> : null}
          </View>
        </View>

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
            <Text style={s.cUnit}>{money(l.unit_price)}</Text>
            <Text style={s.cLine}>{money(l.qty * Number(l.unit_price))}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totRow}><Text>Net</Text><Text>{money(net)}</Text></View>
          <View style={s.totRow}>
            <Text>VAT {Number(d.vatRate)}%</Text><Text>{money(vat)}</Text>
          </View>
          <View style={s.grand}>
            <Text style={s.grandText}>Total</Text>
            <Text style={s.grandText}>{money(gross)}</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {d.company} · {d.companyAddress} · Payment due {fmtDate(d.dueDate)}
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
            {d.clientAddress ? <Text style={s.addr}>{d.clientAddress}</Text> : null}
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
