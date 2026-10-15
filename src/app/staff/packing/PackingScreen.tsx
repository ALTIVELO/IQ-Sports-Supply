'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { markPacked, markShipped, markDelivered,
         addShipment, updateShipment, removeShipment, resendShipped } from '../actions';
import type { ActionResult } from '../actions';
import type { InvoiceType } from '@/lib/types';

interface Inv {
  id: string; number: string; type: InvoiceType; date: string;
  paid: boolean; paid_date: string | null; ready_to_pack: boolean;
  packed: boolean; packed_at: string | null; shipped: boolean; shipped_at: string | null;
  delivered: boolean; delivered_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  clients: { id: string; name: string; address: string | null; credit_account: boolean };
  orders: { number: string; dropship: boolean | null; ship_to: string | null };
  invoice_lines: { sku: string; name: string; qty: number }[];
  /** One row per parcel. The three columns above mirror the first of these. */
  shipments: Parcel[];
}
interface Parcel {
  id: string; carrier: string; tracking_number: string;
  tracking_url: string | null; shipped_at: string; seq: number;
}
interface Named { id: string; name: string }
interface Balance { client_id: string; currency: string; due: number; overdue: number }

export default function PackingScreen({
  locations, activeLocation, queue, waiting, recent, owed = {},
  mayEditTracking = false,
}: {
  locations: Named[]; activeLocation: string;
  queue: Inv[]; waiting: Inv[]; recent: Inv[];
  /** What each client owes, keyed by client, for the ones going out on terms. */
  owed?: Record<string, Balance[]>;
  /** Whether this person may correct a number a customer already has. */
  mayEditTracking?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);

  return (
    <div className="space-y-5">
      {locations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">Site</span>
          <select
            className="max-w-[200px]" value={activeLocation}
            onChange={(e) => router.push(`/staff/packing?location=${e.target.value}`)}
          >
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
          Ready to pack ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <Card><Empty>Nothing waiting to pack at this site.</Empty></Card>
        ) : (
          <div className="space-y-2.5">
            {queue.map((inv) => (
              <PackRow key={inv.id} inv={inv} balance={owed[inv.clients.id]}
                       mayEditTracking={mayEditTracking} onMessage={setMessage} />
            ))}
          </div>
        )}
      </section>

      {waiting.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            Held ({waiting.length})
          </h2>
          <div className="space-y-2.5">
            {waiting.map((inv) => (
              <Card key={inv.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num font-bold">{inv.number}</span>
                  <span className="text-[13px]">{inv.clients.name}</span>
                  <span className="text-[12px] text-mute num">{inv.orders.number}</span>
                  {!inv.paid && !inv.clients.credit_account && <Tag tone="red">Awaiting payment</Tag>}
                  {!inv.paid && inv.clients.credit_account && <Tag tone="amber">On account</Tag>}
                  {inv.paid && !inv.ready_to_pack && <Tag tone="amber">Awaiting stock</Tag>}
                  <a
                    href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                    className="ml-auto text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                  >
                    Invoice
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            Packed
          </h2>
          <div className="space-y-2.5">
            {recent.map((inv) => (
              <PackRow key={inv.id} inv={inv} balance={owed[inv.clients.id]}
                       mayEditTracking={mayEditTracking} onMessage={setMessage} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PackRow({
  inv, balance, mayEditTracking = false, onMessage,
}: {
  inv: Inv;
  /** Whether this person may correct a number a customer already has. */
  mayEditTracking?: boolean;
  /** What this client owes, where it matters — an invoice going out unpaid. */
  balance?: Balance[];
  onMessage: (m: { tone: 'error' | 'success' | 'info'; text: string }) => void;
}) {
  const [shipping, setShipping] = useState(false);
  const [carrier, setCarrier] = useState(inv.carrier ?? '');
  const [tracking, setTracking] = useState(inv.tracking_number ?? '');
  const [pending, startTransition] = useTransition();

  const units = inv.invoice_lines.reduce((a, l) => a + l.qty, 0);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      onMessage(r.ok
        ? { tone: r.warning ? 'info' : 'success', text: r.warning ?? r.message ?? 'Done' }
        : { tone: 'error', text: r.error ?? 'Something went wrong' });
      if (r.ok) setShipping(false);
    });

  return (
    <Card accent={shipping}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="num font-bold">{inv.number}</span>
        <span className="text-[13px]">{inv.clients.name}</span>
        <span className="text-[12px] text-mute num">{inv.orders.number}</span>
        {inv.type !== 'full' && <Tag tone={inv.type === 'backorder' ? 'red' : 'line'}>{inv.type}</Tag>}
        <span className="text-[12px] text-mute num">{units} units · {fmtDate(inv.date)}</span>
        {inv.delivered
          ? <Tag tone="green">Delivered</Tag>
          : inv.shipped && <Tag tone="line">Shipped</Tag>}
        {/* The packer has to know before opening the packing list: a box going
            to a consumer must not have anything with a trade price in it. */}
        {inv.orders.dropship && <Tag tone="amber">Direct to customer</Tag>}
        {/* Going out unpaid, and what is already outstanding beside it. The
            exposure belongs where the decision is, not on another screen. */}
        {!inv.paid && (
          <>
            <Tag tone="amber">On account</Tag>
            {(balance ?? []).map((b) => (
              <span key={b.currency}
                    className={`num text-[12px] font-semibold
                                ${b.overdue > 0 ? 'text-danger' : 'text-mute'}`}>
                {money(b.due, b.currency)} owed
                {b.overdue > 0 && <> · {money(b.overdue, b.currency)} overdue</>}
              </span>
            ))}
          </>
        )}

        <div className="ml-auto flex flex-wrap gap-1.5">
          <a
            href={`/api/invoices/${inv.id}/packing-list`} target="_blank" rel="noreferrer"
            className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
          >
            Packing list
          </a>
          {!inv.packed && (
            <Button small onClick={() => run(() => markPacked(inv.id))} disabled={pending}>
              Mark packed
            </Button>
          )}
          {inv.packed && !inv.shipped && (
            <Button small kind="accent" onClick={() => setShipping(!shipping)}>
              {shipping ? 'Cancel' : 'Mark shipped'}
            </Button>
          )}
          {inv.shipped && !inv.delivered && (
            <Button small kind="accent" disabled={pending} onClick={() => run(() => markDelivered(inv.id))}>
              {pending ? 'Sending…' : 'Mark delivered'}
            </Button>
          )}
        </div>
      </div>

      {inv.shipped && (
        <Parcels
          invoice={inv}
          mayEdit={mayEditTracking}
          pending={pending}
          run={run}
        />
      )}

      {shipping && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Carrier</span>
            <input
              className="w-[150px]" value={carrier} placeholder="DPD"
              onChange={(e) => setCarrier(e.target.value)}
            />
          </label>
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Tracking number</span>
            <input
              className="w-[200px] num" value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <Button
            small kind="accent" disabled={pending || !carrier.trim() || !tracking.trim()}
            onClick={() => run(() => markShipped({ invoiceId: inv.id, carrier, tracking }))}
          >
            {pending ? 'Sending…' : 'Ship & notify client'}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Every parcel on one invoice, and what can be done to them.
 *
 * An order does not always leave in one box, and the list is what the customer
 * is tracking — so it is the list, not the first of them with the rest in
 * somebody's head. Another box can be added by whoever is shipping. Correcting
 * or removing one is an admin's, because by then the customer is holding the
 * number in an email.
 */
function Parcels({ invoice, mayEdit, pending, run }: {
  invoice: Inv;
  mayEdit: boolean;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  // In the order they were recorded, which is the order they were told about.
  const parcels = [...(invoice.shipments ?? [])].sort((a, b) => a.seq - b.seq);

  const start = (p?: Parcel) => {
    setCarrier(p?.carrier ?? parcels[parcels.length - 1]?.carrier ?? '');
    setTracking(p?.tracking_number ?? '');
    setEditing(p?.id ?? null);
    setAdding(!p);
  };
  const stop = () => { setAdding(false); setEditing(null); };

  return (
    <div className="mt-2 space-y-1">
      {parcels.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 text-[12px]">
          {/* Numbered, because "the second box" is how somebody on the phone
              will describe the one that has not turned up. */}
          <span className="text-mute w-10">
            {parcels.length > 1 ? `Box ${i + 1}` : 'Parcel'}
          </span>
          <span className="num">{p.carrier}</span>
          <span className="num font-semibold">{p.tracking_number}</span>
          {p.tracking_url && (
            <a href={p.tracking_url} target="_blank" rel="noreferrer"
               className="text-flame-text font-semibold">Track</a>
          )}
          {mayEdit && editing !== p.id && (
            <>
              <button onClick={() => start(p)}
                      className="text-mute hover:text-ink underline">Edit</button>
              {parcels.length > 1 && (
                <button
                  disabled={pending}
                  onClick={() => {
                    // eslint-disable-next-line no-alert
                    if (!confirm(
                      `Take ${p.tracking_number} off this invoice?\n\n`
                      + 'The customer may already have been given it.',
                    )) return;
                    run(() => removeShipment(p.id));
                  }}
                  className="text-mute hover:text-danger underline"
                >
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {(adding || editing) && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Carrier</span>
            <input className="w-[140px]" value={carrier} placeholder="DPD"
                   onChange={(e) => setCarrier(e.target.value)} />
          </label>
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Tracking number</span>
            <input className="w-[190px] num" value={tracking}
                   onChange={(e) => setTracking(e.target.value)} />
          </label>
          <Button
            small kind="accent"
            disabled={pending || !carrier.trim() || !tracking.trim()}
            onClick={() => {
              const done = (r: ActionResult) => { if (r.ok) stop(); return r; };
              run(async () => done(editing
                ? await updateShipment({ id: editing, carrier, tracking })
                : await addShipment({ invoiceId: invoice.id, carrier, tracking })));
            }}
          >
            {editing ? 'Save' : 'Add parcel'}
          </Button>
          <Button small kind="ghost" onClick={stop}>Cancel</Button>
        </div>
      )}

      {!adding && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => start()}
                  className="text-[12px] font-semibold text-flame-text">
            + Another parcel
          </button>
          {/*
            * Sent when somebody decides to, not on every edit.
            *
            * A number is often corrected before anyone needs telling, and
            * three boxes get entered one after another — an email for each
            * would be worse than the wrong number was. Whoever is looking at
            * the parcels is the one who knows whether the customer should
            * hear, so it is their button.
            */}
          <button
            disabled={pending}
            onClick={() => {
              // eslint-disable-next-line no-alert
              if (!confirm(
                `Email the customer the tracking for ${invoice.number}?\n\n`
                + `They will get ${parcels.length === 1 ? 'the number' : `all ${parcels.length} numbers`} `
                + 'as it stands now, marked as an update to what was sent before.',
              )) return;
              run(() => resendShipped(invoice.id));
            }}
            className="text-[12px] font-semibold text-mute hover:text-ink underline
                       disabled:opacity-50"
          >
            Email the tracking again
          </button>
        </div>
      )}
    </div>
  );
}
