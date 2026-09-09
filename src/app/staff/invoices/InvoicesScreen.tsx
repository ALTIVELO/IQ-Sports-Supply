'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Card, Empty, Money, Notice, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { markPaid, markUnpaid } from '../actions';
import type { ActionResult } from '../actions';
import { pushToXero, pullPaymentStatus } from './actions';

interface Inv {
  id: string; number: string; type: 'full' | 'shipment' | 'backorder';
  date: string; due_date: string; vat_rate: number;
  paid: boolean; paid_date: string | null; packed: boolean; shipped: boolean;
  xero_id: string | null; xero_status: 'not_synced' | 'synced' | 'error';
  xero_error: string | null; exported: boolean;
  clients: { name: string }; orders: { number: string };
  invoice_lines: { qty: number; unit_price: number }[];
}

const FILTERS = [
  ['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['unsynced', 'Not in Xero'],
] as const;

export default function InvoicesScreen({
  invoices, status, xeroConfigured, xeroConnected,
}: { invoices: Inv[]; status: string; xeroConfigured: boolean; xeroConnected: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const unsynced = invoices.filter((i) => i.xero_status !== 'synced');

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok
        ? { tone: r.warning ? 'info' : 'success', text: r.warning ?? r.message ?? 'Done' }
        : { tone: 'error', text: r.error ?? 'Something went wrong' });
    });

  const net = (i: Inv) => i.invoice_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => router.push(key === 'all' ? '/staff/invoices' : `/staff/invoices?status=${key}`)}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${status === key ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-parch'}`}
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap gap-2">
          <a
            href="/api/invoices/export"
            className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
          >
            Xero CSV
          </a>
          {xeroConfigured && xeroConnected && (
            <>
              <Button
                small kind="ghost" disabled={pending || !unsynced.length}
                onClick={() => run(() => pushToXero(unsynced.map((i) => i.id)))}
              >
                Push {unsynced.length} to Xero
              </Button>
              <Button small kind="cobalt" disabled={pending} onClick={() => run(pullPaymentStatus)}>
                Check payments
              </Button>
            </>
          )}
        </div>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {xeroConfigured && !xeroConnected && (
        <Notice tone="info">
          Xero is configured but not connected yet — connect it in Settings. Until then the
          CSV export covers accounts and payments can be marked here by hand.
        </Notice>
      )}

      <Card>
        {invoices.length === 0 ? (
          <Empty>No invoices match this filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th><th>Client</th><th>Order</th><th>Type</th>
                  <th>Date</th><th>Due</th>
                  <th className="text-right">Net</th><th className="text-right">Total</th>
                  <th>Payment</th><th>Xero</th><th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const n = net(inv);
                  return (
                    <tr key={inv.id}>
                      <td className="num font-semibold">{inv.number}</td>
                      <td>{inv.clients?.name}</td>
                      <td className="num">{inv.orders?.number}</td>
                      <td>
                        {inv.type === 'full'
                          ? <Tag tone="line">full</Tag>
                          : <Tag tone={inv.type === 'backorder' ? 'red' : 'line'}>{inv.type}</Tag>}
                      </td>
                      <td className="num whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td className="num whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                      <td className="num text-right"><Money value={n} /></td>
                      <td className="num text-right font-semibold">
                        <Money value={n * (1 + Number(inv.vat_rate) / 100)} />
                      </td>
                      <td className="whitespace-nowrap">
                        {inv.paid
                          ? <Tag tone="green">paid {fmtDate(inv.paid_date)}</Tag>
                          : <Tag tone="red">unpaid</Tag>}
                      </td>
                      <td>
                        {inv.xero_status === 'synced' && <Tag tone="green">synced</Tag>}
                        {inv.xero_status === 'error' && <Tag tone="red">error</Tag>}
                        {inv.xero_status === 'not_synced' &&
                          (inv.exported ? <Tag tone="line">exported</Tag> : <Tag tone="line">new</Tag>)}
                      </td>
                      <td>
                        <div className="flex gap-1.5 justify-end whitespace-nowrap">
                          <a
                            href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                            className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                          >
                            PDF
                          </a>
                          {!inv.paid ? (
                            <Button small kind="ghost" disabled={pending}
                              onClick={() => run(() => markPaid(inv.id, null))}>
                              Mark paid
                            </Button>
                          ) : !inv.shipped && (
                            <Button small kind="ghost" disabled={pending}
                              onClick={() => run(() => markUnpaid(inv.id))}>
                              Reverse
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
