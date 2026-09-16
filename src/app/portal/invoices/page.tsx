import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Money, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Every invoice as a downloadable PDF, with paid/unpaid status and due dates. */
export default async function Invoices() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: invoices } = await sb
    .from('invoices')
    .select(`id, number, type, date, due_date, vat_rate, paid, paid_date,
             orders(number), invoice_lines(qty, unit_price)`)
    .eq('client_id', user.clientId)
    .eq('superseded', false)
    .order('date', { ascending: false })
    .limit(300);

  const gross = (i: { vat_rate: number; invoice_lines: { qty: number; unit_price: number }[] }) =>
    i.invoice_lines.reduce((s, l) => s + l.qty * Number(l.unit_price), 0)
      * (1 + Number(i.vat_rate) / 100);

  // A proforma asks for nothing and a credit note is money the other way, so
  // neither belongs in what this client owes. Counting a proforma here would
  // bill them twice for the same goods once the real invoice follows.
  const outstanding = (invoices ?? [])
    .filter((i) => !i.paid && i.type !== 'proforma' && i.type !== 'credit')
    .reduce((a, i) => a + gross(i), 0)
    - (invoices ?? []).filter((i) => i.type === 'credit').reduce((a, i) => a + gross(i), 0);

  const overdue = (i: { paid: boolean; due_date: string; type: string }) =>
    !i.paid && i.type !== 'proforma' && i.type !== 'credit'
      && new Date(i.due_date) < new Date();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Invoices</h1>
        <p className="text-[13px] text-mute mt-1">
          {outstanding > 0
            ? <>Outstanding balance <span className="num font-semibold text-ink"><Money value={outstanding} /></span> including VAT.</>
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
                    <tr key={i.id}>
                      <td className="num font-semibold">{i.number}</td>
                      <td className="num">{(i.orders as unknown as { number: string })?.number}</td>
                      <td className="num whitespace-nowrap">{fmtDate(i.date)}</td>
                      <td className="num whitespace-nowrap">
                        {i.type === 'proforma' || i.type === 'credit' ? '—' : fmtDate(i.due_date)}
                      </td>
                      <td className="num text-right"><Money value={net} /></td>
                      <td className="num text-right font-semibold">
                        <Money value={net * (1 + Number(i.vat_rate) / 100)} />
                      </td>
                      <td className="whitespace-nowrap">
                        {i.type === 'proforma'
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
