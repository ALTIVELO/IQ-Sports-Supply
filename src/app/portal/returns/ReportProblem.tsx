'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, Notice, Tag } from '@/components/ui';
import { RETURN_REASONS, type ReturnOutcome, type ReturnReason } from '@/lib/types';
import { requestReturn } from './actions';

export interface ReturnableLine {
  id: string; sku: string; name: string;
  /** How many of this line are still available to send back. */
  left: number;
}

/**
 * Reporting a fault or a wrong item, from the order it is about.
 *
 * The reason is asked per line and the list has two entries, because those
 * are the two we accept. There is deliberately no "other" — an other box
 * turns a policy into a negotiation, and a customer who types one and is then
 * refused has been wasted twice.
 *
 * Nothing here decides anything. It collects, and the database says yes or no.
 */
export default function ReportProblem({
  orderId, lines, dispatched, windowClosed, days,
}: {
  orderId: string; lines: ReturnableLine[];
  dispatched: boolean; windowClosed: boolean; days: number;
}) {
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState<ReturnOutcome>('exchange');
  const [picked, setPicked] = useState<Record<string, { qty: number; reason: ReturnReason; note: string }>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const available = lines.filter((l) => l.left > 0);

  if (done) {
    return (
      <Notice tone="success">
        Reported as <strong>{done}</strong>. We will look at it and email you — you can
        follow it on your{' '}
        <Link href="/portal/returns" className="font-semibold underline">returns page</Link>.
      </Notice>
    );
  }

  if (!open) {
    return (
      <Button small kind="ghost" onClick={() => setOpen(true)}>
        Something wrong with this order?
      </Button>
    );
  }

  if (!dispatched) {
    return (
      <Notice tone="info">
        Nothing on this order has been dispatched yet. Reply to your order confirmation and
        we will put it right before it goes — there is nothing to send back.{' '}
        <button onClick={() => setOpen(false)} className="underline font-semibold">Close</button>
      </Notice>
    );
  }

  /*
   * Past the window, say so instead of offering a form that will be refused.
   * Staff can still raise one — request_return() exempts them — so the wording
   * points at a person rather than closing the door, because that exemption
   * exists to be used.
   */
  if (windowClosed) {
    return (
      <Notice tone="info">
        This order was dispatched more than {days} days ago, so it is outside the
        returns window. If something has failed under warranty, ring us and we will
        take it up with the manufacturer.{' '}
        <button onClick={() => setOpen(false)} className="underline font-semibold">Close</button>
      </Notice>
    );
  }

  if (!available.length) {
    return (
      <Notice tone="info">
        Everything on this order has already been reported.{' '}
        <Link href="/portal/returns" className="font-semibold underline">See your returns</Link>.{' '}
        <button onClick={() => setOpen(false)} className="underline font-semibold">Close</button>
      </Notice>
    );
  }

  const chosen = Object.entries(picked).filter(([, v]) => v.qty > 0);

  function submit() {
    setError('');
    startTransition(async () => {
      const r = await requestReturn({
        orderId, wanted,
        lines: chosen.map(([orderLineId, v]) => ({
          orderLineId, qty: v.qty, reason: v.reason, note: v.note,
        })),
      });
      if (r.ok) { setDone(r.number ?? 'your return'); setOpen(false); }
      else setError(r.error ?? 'Could not report that');
    });
  }

  return (
    <div className="border border-ink rounded p-3 mt-2 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold">What is wrong?</span>
        <button onClick={() => setOpen(false)}
                className="ml-auto text-[12px] text-mute hover:text-ink underline">
          Close
        </button>
      </div>

      <p className="text-[12px] text-mute max-w-2xl leading-relaxed">
        We take goods back when they arrive faulty, or when we sent the wrong thing.
        We cannot take back stock that was ordered by mistake or is no longer needed —
        if that is what has happened, ring us and we will see what we can do.
      </p>

      {error && <Notice>{error}</Notice>}

      <div className="space-y-2">
        {available.map((l) => {
          const state = picked[l.id];
          return (
            <div key={l.id} className={`border rounded p-2.5 ${state?.qty ? 'border-flame bg-parch' : 'border-line'}`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="num text-[12px] font-semibold min-w-[110px]">{l.sku}</span>
                {/* On a phone the name takes its own line rather than being cut: a
                    customer choosing between two cassettes needs to read which
                    is which. */}
                <span className="text-[13px] min-w-0 flex-1 basis-full sm:basis-0 sm:truncate">
                  {l.name}
                </span>
                <Tag tone="line">{l.left} available</Tag>
                <label className="text-[11px] font-semibold text-mute">
                  How many
                  <input
                    type="number" min={0} max={l.left}
                    value={state?.qty ?? 0}
                    onChange={(e) => {
                      const qty = Math.max(0, Math.min(l.left, Number(e.target.value) || 0));
                      setPicked((p) => ({
                        ...p,
                        [l.id]: { reason: p[l.id]?.reason ?? 'faulty',
                                  note: p[l.id]?.note ?? '', qty },
                      }));
                    }}
                    className="num w-16"
                  />
                </label>
              </div>

              {state?.qty > 0 && (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {RETURN_REASONS.map((r) => (
                      <button
                        key={r.key}
                        title={r.hint}
                        onClick={() => setPicked((p) => ({
                          ...p, [l.id]: { ...p[l.id], reason: r.key },
                        }))}
                        className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
                          ${state.reason === r.key
                            ? 'bg-ink text-white border-ink'
                            : 'bg-white border-line hover:bg-parch'}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder={state.reason === 'faulty'
                      ? 'What is wrong with it? The more you tell us the faster this goes'
                      : 'What arrived instead?'}
                    value={state.note}
                    onChange={(e) => setPicked((p) => ({
                      ...p, [l.id]: { ...p[l.id], note: e.target.value },
                    }))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-row-line">
        <span className="text-[12px] font-semibold">What would you like?</span>
        {([['exchange', 'A replacement'], ['refund', 'A credit']] as const).map(([v, label]) => (
          <label key={v} className="flex items-center gap-1.5 text-[12px]">
            <input type="radio" name="wanted" checked={wanted === v}
                   onChange={() => setWanted(v)} />
            {label}
          </label>
        ))}
        <Button kind="accent" small disabled={pending || !chosen.length} onClick={submit}>
          {pending ? 'Sending…' : 'Report this'}
        </Button>
      </div>
    </div>
  );
}
