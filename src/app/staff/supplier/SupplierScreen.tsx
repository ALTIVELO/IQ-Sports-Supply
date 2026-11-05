'use client';

import { Fragment, useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate, today } from '@/lib/format';
import { createSupplierOrder, receivePo, resendSupplierOrder } from '../actions';
import QtyStepper from '@/components/QtyStepper';

interface PendingLine {
  id: string; sku: string; name: string; qty: number; bo_qty: number; po_qty: number;
  orders: { id: string; number: string; date: string; clients: { name: string } };
}
interface PoLine {
  id: string; sku: string; name: string; qty: number;
  so_reference: string | null; received_qty: number;
}
interface Po {
  id: string; number: string; date: string; received: boolean; received_at: string | null;
  receive_location_id: string; locations: { name: string } | null; po_lines: PoLine[];
}
interface Named { id: string; name: string }

export default function SupplierScreen({
  pending, pos, locations, defaultLocationId,
}: { pending: PendingLine[]; pos: Po[]; locations: Named[]; defaultLocationId: string }) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [extras, setExtras] = useState<{ sku: string; name: string; qty: number }[]>([]);
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [receiving, setReceiving] = useState<Po | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [pendingTx, startTransition] = useTransition();

  const outstandingOf = (l: PendingLine) => l.bo_qty - l.po_qty;
  const chosen = Object.entries(selected).filter(([, q]) => q > 0);

  /*
   * By order, oldest first, because that is the question being asked.
   *
   * A flat list of SKUs answers "what do I need to order"; it does not answer
   * "where is SO-021", which is the other half of what this screen is for and
   * the half somebody is usually on the phone about.
   */
  const byOrder = [...pending]
    .reduce((groups, line) => {
      const key = line.orders.number;
      const at = groups.find((g) => g.number === key);
      if (at) at.lines.push(line);
      else groups.push({ number: key, order: line.orders, lines: [line] });
      return groups;
    }, [] as { number: string; order: PendingLine['orders']; lines: PendingLine[] }[])
    .sort((a, b) => a.number.localeCompare(b.number));

  const toPlace = pending.reduce((n, l) => n + outstandingOf(l), 0);

  function build() {
    setMessage(null);
    startTransition(async () => {
      const r = await createSupplierOrder({
        locationId,
        backorderLines: chosen.map(([order_line_id, qty]) => ({ order_line_id, qty })),
        extraLines: extras.filter((e) => e.sku.trim() && e.qty > 0),
      });
      setMessage(r.ok
        ? { tone: r.warning ? 'info' : 'success', text: r.warning ?? r.message ?? 'Supplier order created' }
        : { tone: 'error', text: r.error ?? 'Could not create the supplier order' });
      if (r.ok) { setSelected({}); setExtras([]); }
    });
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card>
        <div className="flex flex-wrap items-baseline gap-2 mb-2.5">
          <span className="text-[12px] font-semibold">Orders waiting on the supplier</span>
          <span className="text-[11px] text-mute num">
            {byOrder.length} order{byOrder.length === 1 ? '' : 's'}
            {toPlace > 0
              ? ` · ${toPlace} unit${toPlace === 1 ? '' : 's'} still to place`
              : ' · all placed'}
          </span>
        </div>

        {pending.length === 0 && extras.length === 0 ? (
          <Empty>
            Nothing owed. Every line on every order is either here or has been
            received — orders appear here as they are placed.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Description</th>
                  <th className="text-right">Owed</th>
                  <th className="text-right">With supplier</th>
                  <th className="text-right">To place</th>
                  <th className="w-[150px]">Order now</th>
                </tr>
              </thead>
              <tbody>
                {byOrder.map((g) => (
                  <Fragment key={g.number}>
                    <tr className="bg-parch">
                      <td colSpan={6} className="text-[12px]">
                        <span className="num font-bold">{g.number}</span>
                        <span className="text-mute">
                          {' · '}{fmtDate(g.order.date)}
                          {' · '}{g.order.clients?.name}
                        </span>
                        {g.lines.every((l) => outstandingOf(l) === 0) && (
                          <span className="ml-2"><Tag tone="line">All with supplier</Tag></span>
                        )}
                      </td>
                    </tr>
                    {g.lines.map((l) => {
                      const max = outstandingOf(l);
                      return (
                        <tr key={l.id}>
                          <td className="num font-semibold">{l.sku}</td>
                          <td>{l.name}</td>
                          <td className="num text-right">{l.bo_qty}</td>
                          <td className="num text-right text-mute">{l.po_qty || '—'}</td>
                          <td className={`num text-right ${max ? 'font-semibold' : 'text-mute'}`}>
                            {max || '—'}
                          </td>
                          <td>
                            {/* Capped at what is still outstanding, so a purchase
                                order cannot ask for more than was short — and a
                                line already placed in full has nothing to ask for. */}
                            {max > 0 ? (
                              <QtyStepper
                                value={selected[l.id] ?? 0}
                                min={0} max={max}
                                label={`${l.sku} on this order`}
                                onChange={(qty) => setSelected((s) => ({ ...s, [l.id]: qty }))}
                              />
                            ) : (
                              <span className="text-[11px] text-mute">On order</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {extras.length > 0 && (
                  <tr className="bg-parch">
                    <td colSpan={6} className="text-[12px] font-bold">Stock top-up</td>
                  </tr>
                )}
                {extras.map((e, i) => (
                  <tr key={`x${i}`}>
                    <td>
                      <input
                        value={e.sku} placeholder="SKU"
                        onChange={(ev) => setExtras((xs) => xs.map((x, j) => j === i ? { ...x, sku: ev.target.value } : x))}
                      />
                    </td>
                    <td>
                      <input
                        value={e.name} placeholder="Description"
                        onChange={(ev) => setExtras((xs) => xs.map((x, j) => j === i ? { ...x, name: ev.target.value } : x))}
                      />
                    </td>
                    <td /><td /><td />
                    <td>
                      <QtyStepper
                        value={e.qty}
                        min={1}
                        label={e.sku || 'this stock top-up'}
                        onChange={(qty) => setExtras((xs) =>
                          xs.map((x, j) => (j === i ? { ...x, qty } : x)))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 mt-3">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Receive into</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-[170px]">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <Button small kind="ghost" onClick={() => setExtras((xs) => [...xs, { sku: '', name: '', qty: 1 }])}>
            Add stock line
          </Button>
          <Button
            small kind="accent" onClick={build}
            disabled={pendingTx || (chosen.length === 0 && extras.every((e) => !e.sku.trim()))}
          >
            {pendingTx ? 'Creating…' : 'Create supplier order'}
          </Button>
        </div>
      </Card>

      {pos.map((po) => (
        <PoCard
          key={po.id} po={po}
          onReceive={() => setReceiving(po)}
          receiving={receiving?.id === po.id}
          onClose={() => setReceiving(null)}
          onDone={(text) => { setReceiving(null); setMessage({ tone: 'success', text }); }}
          onError={(text) => setMessage({ tone: 'error', text })}
        />
      ))}
    </div>
  );
}

function PoCard({
  po, onReceive, receiving, onClose, onDone, onError,
}: {
  po: Po; onReceive: () => void; receiving: boolean;
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(po.po_lines.map((l) => [l.id, Math.max(0, l.qty - l.received_qty)])),
  );
  const [availableDate, setAvailableDate] = useState(today());
  const [pending, startTransition] = useTransition();

  const units = po.po_lines.reduce((a, l) => a + l.qty, 0);
  const refs = [...new Set(po.po_lines.map((l) => l.so_reference).filter(Boolean))];

  function confirm() {
    startTransition(async () => {
      const r = await receivePo({
        poId: po.id,
        receipts: Object.entries(qty).map(([po_line_id, q]) => ({ po_line_id, qty: q })),
        availableDate,
      });
      if (r.ok) onDone(r.message ?? 'Received');
      else onError(r.error ?? 'Could not book the stock in');
    });
  }

  function resend() {
    startTransition(async () => {
      const r = await resendSupplierOrder(po.id);
      if (r.ok) onDone(r.message ?? 'Sent');
      else onError(r.error ?? 'Could not send');
    });
  }

  const text = [
    `Purchase order ${po.number} — ${fmtDate(po.date)}`,
    '',
    ...po.po_lines.map((l) => `${l.sku}\t${l.qty}\t${l.name}${l.so_reference ? `\tref ${l.so_reference}` : ''}`),
  ].join('\n');

  return (
    <Card accent={receiving}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="num font-bold text-[14px]">{po.number}</span>
        <span className="text-[12px] text-mute num">
          {fmtDate(po.date)} · {units} units
          {po.locations ? ` · into ${po.locations.name}` : ''}
        </span>
        {refs.length > 0 && <Tag tone="line">{refs.join(', ')}</Tag>}
        {po.received ? <Tag tone="green">Received</Tag> : <Tag tone="line">With supplier</Tag>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button small kind="ghost" onClick={() => navigator.clipboard?.writeText(text)}>Copy</Button>
          <a
            href={`/api/purchase-orders/${po.id}/csv`}
            className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
          >
            CSV
          </a>
          <Button small kind="ghost" onClick={resend} disabled={pending}>Send to James</Button>
          {!po.received && (
            <Button small kind="accent" onClick={receiving ? onClose : onReceive}>
              {receiving ? 'Cancel' : 'Receive stock'}
            </Button>
          )}
        </div>
      </div>

      {receiving && (
        <div className="mt-4">
          <p className="text-[12px] text-mute mb-2.5">
            Quantities book back against the order reference on each line first, then
            oldest-first for anything unreferenced. Surplus becomes free stock at{' '}
            {po.locations?.name}.
          </p>
          <div className="flex items-end gap-2 mb-3">
            <label className="text-[12px]">
              <span className="block font-semibold mb-1">Available from</span>
              <input
                type="date" className="w-[170px]" value={availableDate}
                onChange={(e) => setAvailableDate(e.target.value)}
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Description</th><th>Reference</th>
                  <th className="text-right">Ordered</th>
                  <th className="text-right">Already in</th>
                  <th className="w-[150px]">Receiving</th>
                </tr>
              </thead>
              <tbody>
                {po.po_lines.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{l.sku}</td>
                    <td>{l.name}</td>
                    <td className="num text-[12px] text-mute">{l.so_reference ?? 'stock'}</td>
                    <td className="num text-right">{l.qty}</td>
                    <td className="num text-right text-mute">{l.received_qty || '—'}</td>
                    <td>
                      {/* No ceiling: a supplier can send more than was ordered,
                          and a short delivery is the commoner case — one tap
                          down from what was expected. */}
                      <QtyStepper
                        value={qty[l.id] ?? 0}
                        min={0}
                        label={`${l.sku} received`}
                        onChange={(next) => setQty((q) => ({ ...q, [l.id]: next }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 mt-3">
            <Button small kind="accent" onClick={confirm} disabled={pending}>
              {pending ? 'Booking in…' : 'Confirm receipt'}
            </Button>
            <Button small kind="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
