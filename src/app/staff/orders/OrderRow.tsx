'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Money, Notice, Tag, VoidTag,
         voidedRow, voidedText } from '@/components/ui';
import { fmtDate, today } from '@/lib/format';
import Timeline from '@/components/Timeline';
import { splitInvoice, editOrder, cancelOrder, deleteOrder,
         proformaForBackorder, creditInvoice, markPaid } from '../actions';
import type { InvoiceType, OrderEvent } from '@/lib/types';

interface Line {
  id: string; product_id: string | null; sku: string; name: string;
  qty: number; unit_price: number;
  alloc_qty: number; bo_qty: number; po_qty: number;
}
export interface ProductLite { id: string; sku: string; name: string }
interface Inv {
  id: string; number: string;
  type: InvoiceType; date: string;
  due_date: string; paid: boolean; packed: boolean; shipped: boolean;
  superseded: boolean; ready_to_pack: boolean; vat_rate: number;
}
export interface OrderData {
  id: string; number: string; date: string; status: string; notes: string | null;
  cancelled_reason: string | null;
  clients: { id: string; name: string };
  locations: { name: string } | null;
  order_lines: Line[];
  invoices: Inv[];
  order_events: OrderEvent[];
}

export default function OrderRow({ order, products, costOf, canAmend, canDelete }: {
  order: OrderData; products: ProductLite[];
  /** Order line id → what it cost us, where we know. */
  costOf: Record<string, number>;
  canAmend: boolean; canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [mode, setMode] = useState<'none' | 'edit' | 'cancel' | 'delete' | 'credit' | 'paid'>('none');
  const [message, setMessage] = useState('');
  const [availableDate, setAvailableDate] = useState(today());
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const backordered = order.order_lines.reduce((a, l) => a + l.bo_qty, 0);
  const total = order.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);

  // What this order owes the supplier, and what is left over. Lines we have
  // never costed count as nothing towards the first, which flatters the
  // second — so the count of them is shown rather than hidden.
  const supplier = order.order_lines.reduce((a, l) => a + l.qty * (costOf[l.id] ?? 0), 0);
  const uncosted = order.order_lines.filter((l) => costOf[l.id] === undefined).length;
  const profit = total - supplier;
  const marginPct = total > 0 ? (profit / total) * 100 : 0;
  const live = order.invoices.filter((i) => !i.superseded);
  const fullInvoice = live.find((i) => i.type === 'full');
  const canSplit = Boolean(fullInvoice && !fullInvoice.paid && backordered > 0);

  const cancelled = order.status === 'cancelled';
  // A proforma and a credit note are documents about the order, not stages of
  // it, so they never gate what can still be done to it.
  const realInvoices = live.filter((i) => i.type !== 'proforma' && i.type !== 'credit');
  const settled = realInvoices.some((i) => i.paid);
  const gone = realInvoices.some((i) => i.packed || i.shipped);
  const amendable = canAmend && !cancelled && !settled && !gone;
  const creditable = live.filter((i) => i.type !== 'proforma' && i.type !== 'credit');
  // A proforma asks for nothing and a credit note is money going the other
  // way, so neither is ever waiting on a payment.
  const payable = live.filter(
    (i) => !i.paid && i.type !== 'proforma' && i.type !== 'credit');

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(''); setMessage('');
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { setMode('none'); setSplitting(false); setMessage(r.message ?? 'Done'); }
      else setError(r.error ?? 'That could not be done');
    });
  }

  function doSplit() {
    setError('');
    startTransition(async () => {
      const r = await splitInvoice(order.id, availableDate);
      if (r.ok) setSplitting(false);
      else setError(r.error ?? 'Could not split the invoice');
    });
  }

  return (
    <Card className={cancelled ? voidedRow : ''}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOpen(!open)}
          className={`num text-[14px] font-bold hover:text-flame-text
                      ${cancelled ? voidedText : ''}`}
          aria-expanded={open}
        >
          {order.number}
        </button>
        <span className={`text-[13px] ${cancelled ? 'line-through' : ''}`}>
          {order.clients?.name}
        </span>
        <span className="text-[12px] text-mute num">{fmtDate(order.date)}</span>
        {order.locations && <Tag tone="line">{order.locations.name}</Tag>}
        {/* A cancelled order is not awaiting stock or fully allocated; it is
            simply over, and saying either of those would read as live. */}
        {cancelled
          ? <VoidTag>cancelled</VoidTag>
          : backordered > 0
            ? <Tag tone="red">{backordered} on back order</Tag>
            : <Tag tone="green">Fully allocated</Tag>}
        {live.map((i) => (
          <Tag key={i.id} tone={i.shipped ? 'green' : i.paid ? 'accent' : 'line'}>
            {i.number}
            {i.shipped ? ' shipped' : i.packed ? ' packed' : i.paid ? ' paid' : ' unpaid'}
          </Tag>
        ))}
        <span className="num ml-auto text-[13px] flex items-baseline gap-3">
          <span className="font-semibold">
            <Money value={total} /> <span className="text-mute font-normal">net</span>
          </span>
          {supplier > 0 && (
            <>
              <span className="text-mute">
                <Money value={supplier} /> <span className="font-normal">to supplier</span>
              </span>
              <span className={profit >= 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                <Money value={profit} />{' '}
                <span className="font-normal">({marginPct.toFixed(0)}%)</span>
              </span>
            </>
          )}
        </span>
      </div>

      {open && (
        <div className="mt-4 grid lg:grid-cols-[1fr_240px] gap-6">
          <div className="min-w-0">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Item</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Allocated</th>
                    <th className="text-right">Back order</th>
                    <th className="text-right">With supplier</th>
                    <th className="text-right">Unit</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {order.order_lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{l.sku}</td>
                      <td>{l.name}</td>
                      <td className="num text-right">{l.qty}</td>
                      <td className="num text-right">{l.alloc_qty}</td>
                      <td className={`num text-right ${l.bo_qty ? 'text-danger font-semibold' : 'text-mute'}`}>
                        {l.bo_qty || '—'}
                      </td>
                      <td className="num text-right text-mute">{l.po_qty || '—'}</td>
                      <td className="num text-right"><Money value={Number(l.unit_price)} /></td>
                      <td className="num text-right text-mute">
                        {costOf[l.id] === undefined
                          ? '—' : <Money value={costOf[l.id]} />}
                      </td>
                      <td className="num text-right">
                        {costOf[l.id] === undefined ? (
                          <span className="text-mute">—</span>
                        ) : (
                          <LineMargin price={Number(l.unit_price)} cost={costOf[l.id]} qty={l.qty} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {uncosted > 0 && (
              <p className="text-[12px] text-mute mt-2">
                {uncosted} line{uncosted === 1 ? '' : 's'} with no cost recorded, so the
                margin above is only as complete as the price list. Import a cost column
                on the Import screen and past orders are costed with it.
              </p>
            )}

            {order.notes && (
              <p className="text-[12px] text-mute mt-3">Note: {order.notes}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-4">
              {live.map((i) => (
                <a
                  key={i.id}
                  href={`/api/invoices/${i.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                >
                  {i.number} PDF
                </a>
              ))}
              {canSplit && !splitting && (
                <Button small kind="ghost" onClick={() => setSplitting(true)}>
                  Split into shipment + back order
                </Button>
              )}
              {canAmend && payable.length > 0 && mode === 'none' && (
                <Button small kind="accent" onClick={() => { setMode('paid'); setError(''); }}>
                  Mark paid
                </Button>
              )}
              {canAmend && !cancelled && backordered > 0 && (
                <Button small kind="ghost" disabled={pending}
                        onClick={() => run(() => proformaForBackorder(order.id))}>
                  Proforma for the back order
                </Button>
              )}
              {amendable && mode === 'none' && (
                <Button small kind="ghost" onClick={() => { setMode('edit'); setError(''); }}>
                  Edit lines
                </Button>
              )}
              {canAmend && creditable.length > 0 && mode === 'none' && (
                <Button small kind="ghost" onClick={() => { setMode('credit'); setError(''); }}>
                  Credit note
                </Button>
              )}
              {amendable && mode === 'none' && (
                <Button small kind="ghost" onClick={() => { setMode('cancel'); setError(''); }}>
                  Cancel order
                </Button>
              )}
              {canDelete && amendable && mode === 'none' && (
                <Button small kind="ghost" onClick={() => { setMode('delete'); setError(''); }}>
                  Delete
                </Button>
              )}
            </div>

            {message && <div className="mt-3"><Notice tone="success">{message}</Notice></div>}
            {cancelled && (
              <div className="mt-3">
                <Notice tone="info">
                  Cancelled{order.cancelled_reason ? ` — ${order.cancelled_reason}` : ''}. Stock
                  was released and every invoice on it withdrawn.
                </Notice>
              </div>
            )}
            {canAmend && !cancelled && (settled || gone) && (
              <p className="text-[11px] text-mute mt-2">
                {settled
                  ? 'This order has been paid, so it can no longer be edited or cancelled — raise a credit note instead.'
                  : 'This order has been packed or shipped, so its lines are fixed.'}
              </p>
            )}

            {mode === 'edit' && (
              <EditLines
                lines={order.order_lines} products={products} pending={pending}
                onCancel={() => setMode('none')}
                onSave={(next) => run(() => editOrder(order.id, next))}
              />
            )}
            {mode === 'cancel' && (
              <ConfirmWithReason
                title={`Cancel ${order.number}?`}
                body="Stock goes back on the shelf, anything not yet received comes off the supplier order, and every invoice is withdrawn. The order stays on record."
                confirmLabel="Cancel this order" placeholder="Why, for the record"
                pending={pending} onCancel={() => setMode('none')}
                onConfirm={(reason) => run(() => cancelOrder(order.id, reason))}
              />
            )}
            {mode === 'delete' && (
              <ConfirmWithReason
                title={`Delete ${order.number} entirely?`}
                body="This removes the order and its invoice numbers for good. Cancelling is almost always the right choice — it keeps the record and the reason. Delete only an order raised in error."
                confirmLabel="Delete for good" danger
                pending={pending} onCancel={() => setMode('none')}
                onConfirm={() => run(() => deleteOrder(order.id))}
              />
            )}
            {mode === 'paid' && (
              <MarkPaid
                invoices={payable} pending={pending}
                onCancel={() => setMode('none')}
                onSave={(id, date) => run(() => markPaid(id, date))}
              />
            )}
            {mode === 'credit' && (
              <CreditNote
                invoices={creditable} pending={pending}
                onCancel={() => setMode('none')}
                onSave={(input) => run(() => creditInvoice(input))}
              />
            )}

            {splitting && (
              <div className="mt-3 border border-flame rounded p-3 space-y-2">
                <p className="text-[12px] text-mute">
                  The allocated items are invoiced now; the back order is invoiced separately,
                  dated to the day the stock becomes available.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[12px]">
                    <span className="block font-semibold mb-1">Stock available from</span>
                    <input
                      type="date" value={availableDate}
                      onChange={(e) => setAvailableDate(e.target.value)}
                      className="w-[170px]"
                    />
                  </label>
                  <Button small kind="accent" onClick={doSplit} disabled={pending}>
                    {pending ? 'Splitting…' : 'Split invoice'}
                  </Button>
                  <Button small kind="ghost" onClick={() => setSplitting(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {error && <div className="mt-3"><Notice>{error}</Notice></div>}
          </div>

          <div>
            <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-2.5">
              Status
            </div>
            <Timeline events={order.order_events ?? []} />
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Editing an order's lines.
 *
 * The whole order is sent back, not a list of changes, because that is what is
 * on screen: quantities are typed over, a line is removed by taking it off,
 * and anything in the catalogue can be added. Prices are left alone — this is
 * for correcting what was ordered, not for renegotiating it.
 */
function EditLines({ lines, products, pending, onSave, onCancel }: {
  lines: Line[]; products: ProductLite[]; pending: boolean;
  onSave: (next: { product_id: string; qty: number }[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    () => lines
      .filter((l) => l.product_id)
      .map((l) => ({ product_id: l.product_id as string, sku: l.sku, name: l.name, qty: l.qty })),
  );
  const [q, setQ] = useState('');

  // A line whose product has since been deleted cannot be sent back, so say so
  // rather than dropping it silently on save.
  const orphans = lines.filter((l) => !l.product_id);

  const matches = q.trim().length < 2 ? [] : products
    .filter((p) => !draft.some((d) => d.product_id === p.id))
    .filter((p) => `${p.sku} ${p.name}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <div className="mt-3 border border-ink rounded p-3 space-y-3">
      <h3 className="text-[13px] font-semibold">Edit the lines</h3>

      {orphans.length > 0 && (
        <Notice>
          {orphans.length} line{orphans.length === 1 ? '' : 's'} point at a product that has
          been deleted from the catalogue and cannot be carried through an edit:{' '}
          {orphans.map((l) => l.sku).join(', ')}. Cancel and re-place the order instead.
        </Notice>
      )}

      <div className="space-y-1">
        {draft.map((d, i) => (
          <div key={d.product_id} className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="num font-semibold w-[120px]">{d.sku}</span>
            <span className="flex-1 min-w-0">{d.name}</span>
            <input
              type="number" min={1} value={d.qty} className="num w-20 text-center"
              aria-label={`Quantity of ${d.sku}`}
              onChange={(e) => setDraft((prev) => prev.map((x, j) =>
                j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))}
            />
            <button
              onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
              aria-label={`Remove ${d.sku}`}
              className="text-mute hover:text-danger px-1"
            >
              ×
            </button>
          </div>
        ))}
        {draft.length === 0 && (
          <p className="text-[12px] text-danger">
            Nothing left. An order needs a line — cancel it instead.
          </p>
        )}
      </div>

      <div className="border-t border-line pt-2 space-y-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Add a SKU — search by code or name"
          className="text-[12px] max-w-sm"
        />
        {matches.length > 0 && (
          <div className="border border-line rounded divide-y divide-line">
            {matches.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setDraft((prev) => [...prev,
                    { product_id: p.id, sku: p.sku, name: p.name, qty: 1 }]);
                  setQ('');
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-[12px] text-left hover:bg-parch"
              >
                <span className="num font-semibold w-[120px]">{p.sku}</span>
                <span className="flex-1 min-w-0">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-mute">
        Saving withdraws the current invoice and raises a new one, and re-orders whatever
        is now short from the supplier.
      </p>
      <div className="flex gap-2">
        <Button small kind="accent" disabled={pending || !draft.length || orphans.length > 0}
                onClick={() => onSave(draft.map(({ product_id, qty }) => ({ product_id, qty })))}>
          {pending ? 'Saving…' : 'Save and reissue the invoice'}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** A destructive step, said plainly, with somewhere to record why. */
function ConfirmWithReason({
  title, body, confirmLabel, placeholder, danger, pending, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string;
  placeholder?: string; danger?: boolean; pending: boolean;
  onConfirm: (reason: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className={`mt-3 border rounded p-3 space-y-2 ${danger ? 'border-danger' : 'border-ink'}`}>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="text-[12px] text-mute">{body}</p>
      {placeholder && (
        <input
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder} maxLength={200} className="text-[12px] max-w-sm"
        />
      )}
      <div className="flex gap-2">
        <Button small kind="danger" disabled={pending} onClick={() => onConfirm(reason)}>
          {pending ? 'Working…' : confirmLabel}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onCancel}>Keep it</Button>
      </div>
    </div>
  );
}

/** A credit note against one of this order's invoices, whole or in part. */
function CreditNote({ invoices, pending, onSave, onCancel }: {
  invoices: Inv[]; pending: boolean;
  onSave: (input: { invoiceId: string; lines?: { sku: string; qty: number }[] | null;
                    reason: string }) => void;
  onCancel: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? '');
  const [reason, setReason] = useState('');

  return (
    <div className="mt-3 border border-ink rounded p-3 space-y-3">
      <h3 className="text-[13px] font-semibold">Raise a credit note</h3>
      <p className="text-[12px] text-mute">
        Credits the whole invoice. It is money owed back to the client, so it carries no
        due date and never counts toward what they owe.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px]">
          <span className="block font-semibold mb-1">Against</span>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}
                  className="text-[12px]">
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>{i.number} · {i.type}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px] flex-1 min-w-[200px]">
          <span className="block font-semibold mb-1">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Damaged in transit, returned, priced wrong…"
                 maxLength={200} className="text-[12px]" />
        </label>
      </div>
      <div className="flex gap-2">
        <Button small kind="accent" disabled={pending || !invoiceId}
                onClick={() => onSave({ invoiceId, lines: null, reason })}>
          {pending ? 'Raising…' : 'Raise the credit note'}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Recording a payment against one of this order's invoices.
 *
 * The date defaults to today but is editable, because payment usually reaches
 * the bank before anyone reaches this screen, and an invoice recorded as paid
 * today when it cleared last Tuesday makes the ledger disagree with the bank.
 */
function MarkPaid({ invoices, pending, onSave, onCancel }: {
  invoices: Inv[]; pending: boolean;
  onSave: (invoiceId: string, paidDate: string) => void;
  onCancel: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const chosen = invoices.find((i) => i.id === invoiceId);

  return (
    <div className="mt-3 border border-ink rounded p-3 space-y-3">
      <h3 className="text-[13px] font-semibold">Record a payment</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px]">
          <span className="block font-semibold mb-1">Invoice</span>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}
                  className="text-[12px]">
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>{i.number} · {i.type}</option>
            ))}
          </select>
        </label>
        <label className="text-[12px]">
          <span className="block font-semibold mb-1">Payment received</span>
          <input type="date" value={date} max={today()}
                 min={chosen?.date}
                 onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
        </label>
        <Button small kind="accent" disabled={pending || !invoiceId}
                onClick={() => onSave(invoiceId, date)}>
          {pending ? 'Recording…' : 'Mark paid'}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-[11px] text-mute">
        Once paid, the invoice can be packed as soon as its stock is here. Nothing ships
        before payment.
      </p>
    </div>
  );
}

/** What one line earns, in money and as a share of what it sold for. */
function LineMargin({ price, cost, qty }: { price: number; cost: number; qty: number }) {
  const profit = (price - cost) * qty;
  const pct = price > 0 ? ((price - cost) / price) * 100 : 0;
  return (
    <span className={profit >= 0 ? '' : 'text-danger font-semibold'}>
      <Money value={profit} />
      <span className="text-mute font-normal"> {pct.toFixed(0)}%</span>
    </span>
  );
}
