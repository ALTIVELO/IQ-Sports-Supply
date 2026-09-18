import { fmtDate, money, totals } from '@/lib/format';
import { agencyHeading, agencyLines } from '@/lib/orders/agency';

interface Line { sku: string; name: string; qty: number; unit_price: number }

const table = (lines: Line[], withPrices: boolean, currency?: string) =>
  lines
    .map((l) =>
      withPrices
        ? `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${money(l.unit_price, currency).padStart(10)}  ${l.name}`
        : `  ${l.sku.padEnd(14)} ${String(l.qty).padStart(4)}  ${l.name}`,
    )
    .join('\n');

export function orderConfirmation(o: {
  company: string; clientName: string; orderNumber: string; invoiceNumber: string;
  date: string; dueDate: string; vatRate: number; currency?: string; lines: Line[];
  backordered: { sku: string; name: string; qty: number }[];
  portalUrl: string;
  /** Set where we introduced this order rather than sold it. */
  agencyTerms?: string | null;
  agentBrand?: string | null;
}) {
  const { net, vat, gross } = totals(o.lines, o.vatRate);
  const names = { brand: o.agentBrand || 'the brand', company: o.company };
  const terms = agencyLines(o.agencyTerms, names);

  /*
   * An introduced order is a different email with the same lines on it.
   *
   * Everything after the goods is wrong for it: we are not collecting the
   * money, we are not dispatching, and the total does not include the
   * shipping and taxes the brand will add. Writing one paragraph that covers
   * both would have to be vague about all of it, so the two are written
   * separately and the order decides which it gets.
   */
  if (terms.length) {
    return {
      subject: `${o.company} — order ${o.orderNumber} received, going to ${names.brand}`,
      body: `Thank you for your order.

Order    ${o.orderNumber}
Ref      ${o.invoiceNumber}
Date     ${fmtDate(o.date)}

${table(o.lines, true, o.currency)}

  Goods         ${money(net, o.currency)}
  (before shipping and taxes, which ${names.brand} add on their invoice)

${agencyHeading(names).toUpperCase()}

${terms.map((line) => `  ${line}`).join('\n\n')}

The order confirmation is attached. Nothing is due to us on it. You can follow
the order here at any time:

  ${o.portalUrl}

${o.company}`,
    };
  }

  // Every line goes to our supplier when the order arrives, so singling some
  // out as "on back order" would name the whole order and read as a problem.
  const bo = '\nWe have placed this with our supplier and will confirm dates with you '
           + 'once we have them.\n';

  return {
    subject: `${o.company} — order ${o.orderNumber} confirmed, invoice ${o.invoiceNumber}`,
    body: `Thank you for your order.

Order    ${o.orderNumber}
Invoice  ${o.invoiceNumber}
Date     ${fmtDate(o.date)}
Due      ${fmtDate(o.dueDate)}

${table(o.lines, true, o.currency)}

  Net           ${money(net, o.currency)}
  VAT (${o.vatRate}%)   ${money(vat, o.currency)}
  Total         ${money(gross, o.currency)}
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

export function deliveredNotice(o: {
  company: string; orderNumber: string; invoiceNumber: string;
  lines: { sku: string; name: string; qty: number }[]; portalUrl: string;
}) {
  return {
    subject: `${o.company} — order ${o.orderNumber} delivered`,
    body: `Your order has been delivered.

Order     ${o.orderNumber}
Invoice   ${o.invoiceNumber}

${table(o.lines.map((l) => ({ ...l, unit_price: 0 })), false)}

Full order history and invoices:
  ${o.portalUrl}

${o.company}`,
  };
}

export function applicationNotice(a: {
  company: string; companyName: string; tradingName: string | null;
  contactName: string; email: string; phone: string | null;
  businessType: string | null; website: string | null; socialMedia: string | null;
  vatNo: string | null; companyNumber: string | null; eoriNo: string | null;
  address: string | null; invoicingAddress: string | null;
  message: string | null; reviewUrl: string;
}) {
  return {
    subject: `Trade account application — ${a.companyName}`,
    body: `A new trade account application is waiting for review.

Company            ${a.companyName}
Trading name       ${a.tradingName ?? '—'}
Contact            ${a.contactName}
Email              ${a.email}
Phone              ${a.phone ?? '—'}
Business type      ${a.businessType ?? '—'}

VAT number         ${a.vatNo ?? '—'}
Company number     ${a.companyNumber ?? '—'}
EORI number        ${a.eoriNo ?? '—'}

Website            ${a.website ?? '—'}
Social media       ${a.socialMedia ?? '—'}

Trading address    ${a.address ?? '—'}
Invoicing address  ${a.invoicingAddress ?? '—'}

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

/**
 * Telling a brand there is a box to send.
 *
 * Address and contents. Not what the customer paid for it, not the rest of
 * their order, not their account: a brand packing one box needs to know where
 * it goes and what goes in it, and everything else is ours.
 */
export function dropshipNotice(o: {
  company: string; brandName: string; orderNumber: string; date: string;
  clientName: string; shipTo: string;
  lines: { sku: string; name: string; qty: number }[];
  portalUrl: string;
}) {
  return {
    subject: `${o.company} — order ${o.orderNumber} to dispatch`,
    body: `There is an order for ${o.brandName} to send out.

Order    ${o.orderNumber}
Placed   ${fmtDate(o.date)}

${o.lines.map((l) =>
  `  ${l.sku.padEnd(16)} ${String(l.qty).padStart(4)}  ${l.name}`).join('\n')}

Deliver to
  ${o.clientName}
${o.shipTo.split('\n').map((line) => `  ${line}`).join('\n')}

Mark it dispatched here, and add tracking if you have it — we pass that
straight to the customer:

  ${o.portalUrl}

${o.company}
`,
  };
}

/** ── goods coming back ──────────────────────────────────────────────────── */

const returnLines = (lines: { sku: string; name: string; qty: number; reason: string; note: string | null }[]) =>
  lines.map((l) =>
    `  ${l.sku.padEnd(16)} ${String(l.qty).padStart(4)}  ${l.name}\n`
    + `  ${' '.repeat(16)}      ${l.reason}${l.note ? ` — ${l.note}` : ''}`,
  ).join('\n\n');

/** To the desk, the moment a client reports one. */
export function returnRaised(r: {
  company: string; number: string; clientName: string;
  orderNumber: string; wanted: string;
  lines: { sku: string; name: string; qty: number; reason: string; note: string | null }[];
  reviewUrl: string;
}) {
  return {
    subject: `${r.company} — ${r.clientName} has reported a problem (${r.number})`,
    body: `${r.clientName} has reported a problem with order ${r.orderNumber}.

Return   ${r.number}
Asked for ${r.wanted === 'exchange' ? 'a replacement' : 'a credit'}

${returnLines(r.lines)}

Approve or decline it here:

  ${r.reviewUrl}

${r.company}
`,
  };
}

/**
 * To the client, once somebody has looked.
 *
 * An approval says what to do next, because a customer told "approved" and
 * nothing else will ring up to ask where to send it.
 */
export function returnDecision(r: {
  company: string; number: string; companyName: string; orderNumber: string;
  approved: boolean; note: string | null;
  returnAddress: string; portalUrl: string;
}) {
  return {
    subject: `${r.company} — return ${r.number} ${r.approved ? 'approved' : 'not accepted'}`,
    body: r.approved
      ? `We have approved return ${r.number} against order ${r.orderNumber}.
${r.note ? `\n${r.note}\n` : ''}
Please send the goods back to:

${r.returnAddress.split('\n').map((l) => `  ${l}`).join('\n')}

Write ${r.number} on the outside of the parcel so we can match it up. We will
email you again as soon as it reaches us.

  ${r.portalUrl}

${r.company}
`
      : `We are sorry — we cannot accept return ${r.number} against order ${r.orderNumber}.
${r.note ? `\n${r.note}\n` : ''}
We take goods back when they arrive faulty or when we sent the wrong thing.
If you think we have this wrong, reply to this email and we will look again.

  ${r.portalUrl}

${r.company}
`,
  };
}

/** To the client, once it is settled one way or the other. */
export function returnSettled(r: {
  company: string; number: string; companyName: string;
  outcome: string; creditNumber: string | null; replacementOrder: string | null;
  portalUrl: string;
}) {
  const what = r.outcome === 'refund'
    ? `We have raised credit note ${r.creditNumber ?? ''} against your account.`.trim()
    : `Your replacement is on order${r.replacementOrder ? ` as ${r.replacementOrder}` : ''} and will be dispatched in the usual way.`;

  return {
    subject: `${r.company} — return ${r.number} settled`,
    body: `Your goods are back with us and return ${r.number} is settled.

${what}

Thank you for your patience, and sorry for the trouble.

  ${r.portalUrl}

${r.company}
`,
  };
}
