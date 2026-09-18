'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import {
  RETURN_REASONS, RETURN_STATUS_LABEL,
  type ReturnOutcome, type ReturnReason, type ReturnStatus,
} from '@/lib/types';
import { decideReturn, receiveReturn, resolveReturn } from './actions';

export interface StaffReturn {
  id: string; number: string;
  status: ReturnStatus; wanted: ReturnOutcome;
  createdAt: string; decidedAt: string | null; decisionNote: string | null;
  receivedAt: string | null; resolvedAt: string | null;
  clientName: string; orderNumber: string; creditNumber: string | null;
  lines: { id: string; sku: string; name: string; qty: number; reason: ReturnReason; note: string | null }[];
  replacementOptions: { id: string; number: string; date: string }[];
}

interface Named { id: string; name: string }
type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

const REASON_LABEL = Object.fromEntries(RETURN_REASONS.map((r) => [r.key, r.label]));

const TONE: Record<ReturnStatus, 'accent' | 'green' | 'line' | 'ink'> = {
  requested: 'accent',
  approved: 'ink',
  received: 'ink',
  resolved: 'green',
  declined: 'line',
  cancelled: 'line',
};

/** The three stages that need somebody, and everything that no longer does. */
export default function ReturnsQueue({
  returns, locations,
}: { returns: StaffReturn[]; locations: Named[] }) {
  const [message, setMessage] = useState<Msg>(null);

  const open = returns.filter((r) => ['requested', 'approved', 'received'].includes(r.status));
  const closed = returns.filter((r) => !['requested', 'approved', 'received'].includes(r.status));

  return (
    <div className="space-y-5">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <Card><Empty>Nothing waiting. Every return has been settled.</Empty></Card>
        ) : (
          <div className="space-y-2.5">
            {open.map((r) => (
              <ReturnCard key={r.id} r={r} locations={locations} onMessage={setMessage} />
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">Settled</h2>
          <Card>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Return</th><th>Client</th><th>Order</th>
                    <th>Reported</th><th>Outcome</th><th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((r) => (
                    <tr key={r.id}>
                      <td className="num font-semibold">{r.number}</td>
                      <td>{r.clientName}</td>
                      <td className="num">{r.orderNumber}</td>
                      <td className="num whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                      <td>
                        <Tag tone={TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag>
                        {r.creditNumber && <span className="num text-[11px] text-mute ml-1.5">{r.creditNumber}</span>}
                      </td>
                      <td className="text-mute">{r.decisionNote ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function ReturnCard({
  r, locations, onMessage,
}: { r: StaffReturn; locations: Named[]; onMessage: (m: Msg) => void }) {
  const [note, setNote] = useState('');
  const [locationId, setLocationId] = useState('');
  const [outcome, setOutcome] = useState<ReturnOutcome>(r.wanted);
  const [replacement, setReplacement] = useState('');
  const [pending, startTransition] = useTransition();

  const units = r.lines.reduce((a, l) => a + l.qty, 0);
  const restockable = r.lines.filter((l) => l.reason === 'wrong_item').reduce((a, l) => a + l.qty, 0);

  function run(work: () => Promise<{ ok: boolean; error?: string; message?: string; warning?: string }>) {
    onMessage(null);
    startTransition(async () => {
      const res = await work();
      if (!res.ok) onMessage({ tone: 'error', text: res.error ?? 'That did not work' });
      else if (res.warning) onMessage({ tone: 'info', text: `${res.message}. ${res.warning}` });
      else onMessage({ tone: 'success', text: res.message ?? 'Done' });
    });
  }

  return (
    <Card accent={r.status === 'requested'}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="num font-bold">{r.number}</span>
        <Tag tone={TONE[r.status]}>{RETURN_STATUS_LABEL[r.status]}</Tag>
        <span className="text-[13px] font-semibold">{r.clientName}</span>
        <span className="text-[12px] text-mute num">order {r.orderNumber}</span>
        <span className="text-[12px] text-mute num">{fmtDate(r.createdAt)}</span>
        <span className="text-[12px] text-mute ml-auto">
          {units} unit{units === 1 ? '' : 's'} · asked for {r.wanted === 'exchange' ? 'a replacement' : 'a credit'}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table>
          <thead>
            <tr><th>SKU</th><th>Item</th><th className="text-right">Qty</th><th>Why</th><th>What they said</th></tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id}>
                <td className="num">{l.sku}</td>
                <td>{l.name}</td>
                <td className="num text-right">{l.qty}</td>
                <td>
                  <Tag tone={l.reason === 'faulty' ? 'line' : 'accent'}>
                    {REASON_LABEL[l.reason] ?? l.reason}
                  </Tag>
                </td>
                <td className="text-mute">{l.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r.decisionNote && (
        <p className="text-[12px] text-mute mt-2">
          <span className="font-semibold">Your note:</span> {r.decisionNote}
        </p>
      )}

      {r.status === 'requested' && (
        <div className="mt-3 pt-3 border-t border-row-line space-y-2">
          <input
            placeholder="A note for the customer — where to send it, or why not (optional)"
            value={note} onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button kind="accent" small disabled={pending}
                    onClick={() => run(() => decideReturn({ id: r.id, approve: true, note }))}>
              Approve
            </Button>
            <Button kind="danger" small disabled={pending}
                    onClick={() => run(() => decideReturn({ id: r.id, approve: false, note }))}>
              Decline
            </Button>
            <span className="text-[12px] text-mute self-center">
              Approving emails them the address to send it to.
            </span>
          </div>
        </div>
      )}

      {r.status === 'approved' && (
        <div className="mt-3 pt-3 border-t border-row-line flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold text-mute">
            Book in at
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="ml-1.5">
              <option value="">Where the order shipped from</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <Button kind="accent" small disabled={pending}
                  onClick={() => run(() => receiveReturn({ id: r.id, locationId }))}>
            The goods are here
          </Button>
          <span className="text-[12px] text-mute">
            {restockable > 0
              ? `${restockable} of ${units} will go back on the shelf — the rest are faulty.`
              : 'Nothing here goes back on sale; it is all reported faulty.'}
          </span>
        </div>
      )}

      {r.status === 'received' && (
        <div className="mt-3 pt-3 border-t border-row-line space-y-2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] font-semibold">Settle this as</span>
            {([['refund', 'A credit note'], ['exchange', 'A replacement order']] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5 text-[12px]">
                <input type="radio" name={`outcome-${r.id}`} checked={outcome === v}
                       onChange={() => setOutcome(v)} />
                {label}
              </label>
            ))}
          </div>

          {outcome === 'exchange' ? (
            <div className="flex flex-wrap items-center gap-2">
              <select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">Which order is the replacement?</option>
                {r.replacementOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.number} · {fmtDate(o.date)}</option>
                ))}
              </select>
              <span className="text-[12px] text-mute">
                Raise it on the order desk first, then pick it here.
              </span>
            </div>
          ) : (
            <p className="text-[12px] text-mute">
              A credit note is raised against the invoice these goods were billed on,
              for these quantities only.
            </p>
          )}

          <Button kind="accent" small
                  disabled={pending || (outcome === 'exchange' && !replacement)}
                  onClick={() => run(() => resolveReturn({
                    id: r.id, outcome, replacementOrderId: replacement,
                  }))}>
            Settle it
          </Button>
        </div>
      )}
    </Card>
  );
}
