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

  /*
   * What can go to the supplier.
   *
   * An order with something owed, obviously. Also one marked as fully here:
   * the tick is sometimes wrong, and the goods are sometimes damaged or
   * missing when somebody goes to pack them, and the answer to both is to
   * order them. Sending such an order puts it back on back order, which the
   * bar says before the button is pressed.
   *
   * Not a cancelled one, and not one already packed or sent: what went out
   * is a record of what went out.
   */
  const gone = (o: OrderData) => o.invoices
    .some((i) => !i.superseded && (i.packed || i.shipped));
  const sendable = rows.filter((o) =>
    o.status !== 'cancelled' && !gone(o) && o.order_lines.some((l) => l.product_id));
  const owing = (o: OrderData) => o.order_lines.some((l) => l.bo_qty > 0);

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

  const picks = sendable.filter((o) => chosen.includes(o.id));
  const sites = new Set(picks.map((o) => o.locations?.name ?? ''));
  // The ones the send would take back out of the packing queue.
  const here = picks.filter((o) => !owing(o));

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
              ? `${chosen.length} of ${sendable.length} picked`
              : `${sendable.filter(owing).length} of ${sendable.length} waiting on the supplier`}
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
          {sites.size <= 1 && here.length > 0 && (
            <span className="text-[12px] text-mute">
              {here.map((o) => o.number).join(', ')}{' '}
              {here.length === 1 ? 'is' : 'are'} marked as here — sending{' '}
              {here.length === 1 ? 'it' : 'them'} puts {here.length === 1 ? 'it' : 'them'}{' '}
              back on back order.
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
            onPick={sendable.includes(o)
              ? (on) => setPicked((p) =>
                  (on ? [...new Set([...p, o.id])] : p.filter((id) => id !== o.id)))
              : undefined}
          />
        ))}
      </div>
    </>
  );
}
