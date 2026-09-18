import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, Tag, VoidTag, voidedRow, voidedText } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Every invoice as a downloadable PDF, with paid/unpaid status and due dates. */
export default async function Invoices() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: invoices } = await sb
    .from('invoices')
    .select(`id, number, type, date, due_date, vat_rate, paid, paid_date, superseded, currency, agency,
             orders(number), invoice_lines(qty, unit_price)`)
    .eq('client_id', user.clientId)
    .order('date', { ascending: false })
    .limit(300);

  const gross = (i: { vat_rate: number; invoice_lines: { qty: number; unit_price: number }[] }) =>
    i.invoice_lines.reduce((s, l) => s + l.qty * Number(l.unit_price), 0)
      * (1 + Number(i.vat_rate) / 100);

  // A superseded invoice was withdrawn and replaced. It is still listed — the
  // number was issued and the client may have it on file — but it is owed by
  // nobody, so it counts towards nothing below.
  const owed = (invoices ?? []).filter((i) => !i.superseded);

  // A proforma asks for nothing and a credit note is money the other way, so
  // neither belongs in what this client owes. Counting a proforma here would
  // bill them twice for the same goods once the real invoice follows.
  //
  // Per currency, because a euro invoice and a sterling one are two debts and
  // adding them would state a balance that is owed to nobody. A client who has
  // only ever been invoiced in one currency sees exactly what they saw before.
  const balances = new Map<string, number>();
  for (const i of owed) {
    // A proforma asks for nothing, and neither does the acknowledgement of an
    // order the brand invoices. Neither belongs in a balance owed to us.
    if (i.type === 'proforma' || i.agency) continue;
    const code = i.currency ?? 'GBP';
    const sign = i.type === 'credit' ? -1 : i.paid ? 0 : 1;
    if (sign) balances.set(code, (balances.get(code) ?? 0) + sign * gross(i));
  }
  const outstanding = [...balances].filter(([, v]) => v > 0);

  const overdue = (i: {
    paid: boolean; due_date: string; type: string; superseded: boolean; agency: boolean;
  }) =>
    !i.superseded && !i.paid && !i.agency
      && i.type !== 'proforma' && i.type !== 'credit'
      && new Date(i.due_date) < new Date();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Invoices</h1>
        <p className="text-[13px] text-mute mt-1">
          {outstanding.length
            ? <>
                Outstanding balance{' '}
                {outstanding.map(([code, value], n) => (
                  <span key={code}>
                    {n > 0 ? ' and ' : ''}
                    <span className="num font-semibold text-ink">
                      <Money value={value} currency={code} />
                    </span>
                  </span>
                ))}{' '}including VAT.
              </>
            : 'Nothing outstanding — thank you.'}
        </p>
      </div>

      {!invoices?.length ? (
        <Card><Empty>No invoices yet.</Empty></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th><th>Order</th><th>Date</th><th>Due</th>
                  <th className="text-right">Net</th><th className="text-right">Total</th>
                  <th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const net = i.invoice_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
                  return (
                    <tr key={i.id} className={i.superseded ? voidedRow : ''}>
                      <td className={`num font-semibold ${i.superseded ? voidedText : ''}`}>
                        {i.number}
                      </td>
                      <td className="num">{(i.orders as unknown as { number: string })?.number}</td>
                      <td className="num whitespace-nowrap">{fmtDate(i.date)}</td>
                      <td className="num whitespace-nowrap">
                        {i.superseded || i.type === 'proforma' || i.type === 'credit'
                          ? '—' : fmtDate(i.due_date)}
                      </td>
                      <td className="num text-right">
                        <Money value={net} currency={i.currency} />
                      </td>
                      <td className={`num text-right font-semibold
                                      ${i.superseded ? 'line-through' : ''}`}>
                        <Money value={net * (1 + Number(i.vat_rate) / 100)} currency={i.currency} />
                      </td>
                      <td className="whitespace-nowrap">
                        {i.superseded
                          ? <VoidTag>withdrawn</VoidTag>
                          : i.agency
                            ? <Tag tone="line">the brand invoices this</Tag>
                          : i.type === 'proforma'
                            ? <Tag tone="line">proforma · nothing to pay</Tag>
                            : i.type === 'credit'
                              ? <Tag tone="green">credit note</Tag>
                              : i.paid
                                ? <Tag tone="green">paid {fmtDate(i.paid_date)}</Tag>
                                : overdue(i)
                                  ? <Tag tone="red">overdue</Tag>
                                  : <Tag tone="line">due</Tag>}
                      </td>
                      <td className="text-right">
                        <a
                          href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"
                          className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch whitespace-nowrap"
                        >
                          PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
