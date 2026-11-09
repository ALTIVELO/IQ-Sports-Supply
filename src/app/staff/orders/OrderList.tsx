'use client';

import { useState, useTransition } from 'react';
import { Button, Notice } from '@/components/ui';
import OrderRow, { type OrderData, type ProductLite } from './OrderRow';
import { sendOrdersToJames } from '../actions';

/**
 * The orders, and the one thing that is done to several of them at once.
 *
 * Sending a morning's orders to Madison as one order is the job this screen
 * could not do: everything else here is about a single order, so the rows
 * owned their own state and the page had none. The selection lives here
 * because it belongs to the list rather than to any row in it.
 */
export default function OrderList({
  rows, products, costOf, company, canAmend, canDelete,
}: {
  rows: OrderData[]; products: ProductLite[];
  costOf: Record<string, number>; company: string;
  canAmend: boolean; canDelete: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  // Only an order with something still owed can be sent; the rest have
  // nothing the supplier is waiting to hear about.
  const owing = (o: OrderData) =>
    o.status !== 'cancelled' && o.order_lines.some((l) => l.bo_qty > 0);
  const sendable = rows.filter(owing);

  // Picked orders that are still on screen: a filter can take one away
  // underneath the selection, and sending one that is no longer listed is
  // not what the box that was ticked meant.
  const chosen = picked.filter((id) => sendable.some((o) => o.id === id));

  function send() {
    setMessage(''); setError('');
    startTransition(async () => {
      const r = await sendOrdersToJames(chosen);
      if (r.ok) { setMessage(r.message ?? 'Sent to James'); setPicked([]); }
      else setError(r.error ?? 'That could not be sent');
    });
  }

  const sites = new Set(sendable.filter((o) => chosen.includes(o.id))
    .map((o) => o.locations?.name ?? ''));

  return (
    <>
      {sendable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
            <input
              type="checkbox"
              checked={chosen.length === sendable.length && sendable.length > 0}
              // Neither ticked nor empty while only some are: the box says
              // what it would do, and it would not clear the others.
              ref={(el) => {
                if (el) el.indeterminate = chosen.length > 0 && chosen.length < sendable.length;
              }}
              onChange={(e) => setPicked(e.target.checked ? sendable.map((o) => o.id) : [])}
            />
            Pick orders to send
          </label>
          <span className="text-[12px] text-mute num">
            {chosen.length
              ? `${chosen.length} of ${sendable.length} waiting on the supplier`
              : `${sendable.length} waiting on the supplier`}
          </span>
          {chosen.length > 0 && (
            <Button small kind="accent" onClick={send} disabled={pending || sites.size > 1}>
              {pending
                ? 'Sending…'
                : `Send ${chosen.length} order${chosen.length === 1 ? '' : 's'} to James`}
            </Button>
          )}
          {sites.size > 1 && (
            <span className="text-[12px] text-danger">
              Those are fulfilled from different sites — one sheet is one delivery
              address, so send them a site at a time.
            </span>
          )}
        </div>
      )}

      {message && <div className="mb-3"><Notice tone="success">{message}</Notice></div>}
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}

      <div className="space-y-2.5">
        {rows.map((o) => (
          <OrderRow
            key={o.id}
            order={o}
            products={products}
            costOf={costOf}
            company={company}
            canAmend={canAmend}
            canDelete={canDelete}
            picked={picked.includes(o.id)}
            onPick={owing(o)
              ? (on) => setPicked((p) =>
                  (on ? [...new Set([...p, o.id])] : p.filter((id) => id !== o.id)))
              : undefined}
          />
        ))}
      </div>
    </>
  );
}
