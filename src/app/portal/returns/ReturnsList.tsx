'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Notice, Tag } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { RETURN_STATUS_LABEL, type ReturnOutcome, type ReturnReason,
         type ReturnStatus } from '@/lib/types';
import { cancelReturn } from './actions';

export interface ReturnRow {
  id: string; number: string;
  status: ReturnStatus; wanted: ReturnOutcome;
  createdAt: string;
  decidedAt: string | null; decisionNote: string | null;
  receivedAt: string | null; resolvedAt: string | null;
  orderNumber: string; creditNumber: string | null;
  lines: { id: string; sku: string; name: string; qty: number;
           reason: ReturnReason; note: string | null }[];
}

const TONE: Record<ReturnStatus, 'line' | 'green' | 'red' | 'accent'> = {
  requested: 'line', approved: 'accent', declined: 'red',
  received: 'accent', resolved: 'green', cancelled: 'line',
};

export default function ReturnsList({ returns }: { returns: ReturnRow[] }) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error && <Notice>{error}</Notice>}

      {returns.map((r) => (
        <Card key={r.id} className={r.status === 'cancelled' ? 'opacity-60' : ''}>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="num text-[14px] font-bold">{r.number}</span>
            <span className="text-[12px] text-mute num">
              order {r.orderNumber} · reported {fmtDate(r.createdAt)}
            </span>
            <Tag tone={TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag>
            <span className="text-[12px] text-mute ml-auto">
              {r.wanted === 'exchange' ? 'Replacement asked for' : 'Credit asked for'}
            </span>
          </div>

          <div className="overflow-x-auto mt-3">
            <table>
              <thead>
                <tr><th>SKU</th><th>Item</th><th className="text-right">Qty</th><th>What is wrong</th></tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{l.sku}</td>
                    <td>{l.name}</td>
                    <td className="num text-right">{l.qty}</td>
                    <td className="text-[12px]">
                      {l.reason === 'faulty' ? 'Faulty' : 'Wrong item sent'}
                      {l.note && <span className="text-mute"> — {l.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Said in order, so the customer can see where it has got to without
              having to know what our statuses mean. */}
          <div className="mt-3 text-[12px] text-mute space-y-1">
            {r.decidedAt && (
              <p>
                <strong className="text-ink">
                  {r.status === 'declined' ? 'Not accepted' : 'Approved'}
                </strong>{' '}
                {fmtDateTime(r.decidedAt)}
                {r.decisionNote && <> — {r.decisionNote}</>}
              </p>
            )}
            {r.receivedAt && <p>Back with us {fmtDateTime(r.receivedAt)}</p>}
            {r.resolvedAt && (
              <p>
                <strong className="text-ink">Settled</strong> {fmtDateTime(r.resolvedAt)}
                {r.creditNumber && <> — credit note {r.creditNumber}</>}
              </p>
            )}
            {r.status === 'approved' && (
              <p className="text-ink">
                Send it back to us quoting {r.number}. We will settle it as soon as it lands.
              </p>
            )}
          </div>

          {r.status === 'requested' && (
            <div className="mt-3">
              <Button
                small kind="ghost" disabled={pending}
                onClick={() => startTransition(async () => {
                  const res = await cancelReturn(r.id);
                  if (!res.ok) setError(res.error ?? 'Could not withdraw that');
                })}
              >
                Withdraw this
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
