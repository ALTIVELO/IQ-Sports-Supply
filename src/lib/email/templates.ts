import { fmtDate, money, totals } from '@/lib/format';

interface Line { sku: string; name: string; qty: number; unit_price: number }

const table = (lines: Line[], withPrices: boolean) =>
  lines
    .map((l) =>
      withPrices
        ? `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${money(l.unit_price).padStart(10)}  ${l.name}`
        : `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${l.name}`,
    )
    .join('\n');

export function orderConfirmation(o: {
  company: string; clientName: string; orderNumber: string; invoiceNumber: string;
  date: string; dueDate: string; vatRate: number; lines: Line[];
  backordered: { sku: string; name: string; qty: number }[];
  portalUrl: string;
}) {
  const { net, vat, gross } = totals(o.lines, o.vatRate);
  const bo = o.backordered.length
    ? `\nOn back order — we have ordered these from our supplier and will confirm the availability date:\n${o.backordered
        .map((l) => `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${l.name}`)
        .join('\n')}\n`
    : '';

  return {
    subject: `${o.company} — order ${o.orderNumber} confirmed, invoice ${o.invoiceNumber}`,
    body: `Thank you for your order.

Order    ${o.orderNumber}
Invoice  ${o.invoiceNumber}
Date     ${fmtDate(o.date)}
Due      ${fmtDate(o.dueDate)}

${table(o.lines, true)}

  Net           ${money(net)}
  VAT (${o.vatRate}%)   ${money(vat)}
  Total         ${money(gross)}
${bo}
The invoice PDF is attached. Your order will be dispatched once payment has
been received; you can follow its progress at any time here:

  ${o.portalUrl}

${o.company}`,
  };
}

/**
 * What goes to the supplier: SKU, product name and quantity only. No prices of
 * any kind, no client identity. Every line carries its SO reference and the
 * supplier is asked to quote it back.
 */
export function supplierOrder(o: {
  company: string; poNumber: string; date: string;
  groups: { soReference: string | null; lines: { sku: string; name: string; qty: number }[] }[];
}) {
  const blocks = o.groups
    .map((g) => {
      const head = g.soReference
        ? `Our reference ${g.soReference} — please quote this on your paperwork and packaging`
        : 'Stock order — no client reference';
      const rows = g.lines
        .map((l) => `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${l.name}`)
        .join('\n');
      return `${head}\n${rows}`;
    })
    .join('\n\n');

  return {
    subject: `${o.company} — purchase order ${o.poNumber}`,
    body: `Purchase order ${o.poNumber}
Date ${fmtDate(o.date)}

${blocks}

Please quote the reference shown against each group on your delivery note and
on the outside of each carton, so we can book the goods in against the correct
customer order.

${o.company}`,
  };
}

export function shippedNotice(o: {
  company: string; orderNumber: string; invoiceNumber: string;
  carrier: string; tracking: string; trackingUrl: string;
  lines: { sku: string; name: string; qty: number }[]; portalUrl: string;
}) {
  return {
    subject: `${o.company} — order ${o.orderNumber} has shipped`,
    body: `Your order is on its way.

Order     ${o.orderNumber}
Invoice   ${o.invoiceNumber}
Carrier   ${o.carrier}
Tracking  ${o.tracking}

Track it here:
  ${o.trackingUrl}

${table(o.lines.map((l) => ({ ...l, unit_price: 0 })), false)}

Full order history and invoices:
  ${o.portalUrl}

${o.company}`,
  };
}

export function applicationNotice(a: {
  company: string; companyName: string; contactName: string; email: string;
  phone: string | null; businessType: string | null; website: string | null;
  vatNo: string | null; address: string | null; message: string | null; reviewUrl: string;
}) {
  return {
    subject: `Trade account application — ${a.companyName}`,
    body: `A new trade account application is waiting for review.

Company        ${a.companyName}
Contact        ${a.contactName}
Email          ${a.email}
Phone          ${a.phone ?? '—'}
Business type  ${a.businessType ?? '—'}
Website        ${a.website ?? '—'}
VAT number     ${a.vatNo ?? '—'}
Address        ${a.address ?? '—'}

${a.message ? `Message:\n${a.message}\n` : ''}
Review it here:
  ${a.reviewUrl}

${a.company}`,
  };
}

export function welcomeEmail(a: {
  company: string; companyName: string; tierName: string; loginUrl: string;
}) {
  return {
    subject: `${a.company} — your trade account is open`,
    body: `Welcome.

Your trade account for ${a.companyName} has been approved on our ${a.tierName}
pricing tier. Sign in here — we will email you a one-time link, so there is no
password to remember:

  ${a.loginUrl}

You will see your own pricing, live stock availability, your order history and
every invoice.

${a.company}`,
  };
}

export function rejectionEmail(a: { company: string; companyName: string; reason: string | null }) {
  return {
    subject: `${a.company} — trade account application`,
    body: `Thank you for your interest in opening a trade account with us.

We are not able to open an account for ${a.companyName} at this time.${
      a.reason ? `\n\n${a.reason}` : ''
    }

${a.company}`,
  };
}
