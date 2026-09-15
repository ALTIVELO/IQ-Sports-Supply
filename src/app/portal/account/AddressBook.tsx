'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Field, Notice, Tag } from '@/components/ui';
import { deleteMyAddress, makeAddressDefault, saveMyAddress } from './actions';

export interface Address {
  id: string;
  label: string;
  recipient: string | null;
  address: string;
  is_default: boolean;
}

/**
 * Delivery addresses.
 *
 * A trade customer with a shop and a warehouse needs more than one, and picks
 * between them at checkout. One is always the default, so a client with a
 * single address never has to think about any of this.
 */
export default function AddressBook({ addresses }: { addresses: Address[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(''); setMessage('');
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { setMessage(r.message ?? 'Saved'); setEditing(null); }
      else setError(r.error ?? 'That could not be saved');
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Delivery addresses</h2>
          <p className="text-[12px] text-mute mt-1">
            Add as many as you need. You choose which one an order ships to when you
            place it.
          </p>
        </div>
        {editing !== 'new' && (
          <Button small onClick={() => { setEditing('new'); setError(''); setMessage(''); }}>
            Add an address
          </Button>
        )}
      </div>

      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      {editing === 'new' && (
        <AddressForm
          pending={pending}
          onCancel={() => setEditing(null)}
          onSave={(values) => run(() => saveMyAddress({
            ...values, is_default: addresses.length === 0 || values.is_default,
          }))}
        />
      )}

      {addresses.length === 0 && editing !== 'new' && (
        <Empty>
          No delivery address yet. Orders cannot be dispatched until you add one.
        </Empty>
      )}

      <div className="space-y-2">
        {addresses.map((a) => (
          editing === a.id ? (
            <AddressForm
              key={a.id}
              initial={a}
              pending={pending}
              onCancel={() => setEditing(null)}
              onSave={(values) => run(() => saveMyAddress({ ...values, id: a.id }))}
            />
          ) : (
            <div key={a.id}
                 className="border border-line rounded p-3 flex flex-col sm:flex-row
                            sm:items-start gap-x-4 gap-y-3">
              <div className="min-w-0 sm:flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold">{a.label}</span>
                  {a.is_default && <Tag tone="green">Default</Tag>}
                </div>
                {a.recipient && (
                  <div className="text-[12px] text-mute mt-1">FAO {a.recipient}</div>
                )}
                <div className="text-[12px] text-mute mt-1 whitespace-pre-line leading-relaxed">
                  {a.address}
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {!a.is_default && (
                  <Button small kind="ghost" disabled={pending}
                          onClick={() => run(() => makeAddressDefault(a.id))}>
                    Make default
                  </Button>
                )}
                <Button small kind="ghost" disabled={pending}
                        onClick={() => { setEditing(a.id); setError(''); setMessage(''); }}>
                  Edit
                </Button>
                {addresses.length > 1 && (
                  <Button small kind="ghost" disabled={pending}
                          onClick={() => run(() => deleteMyAddress(a.id))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          )
        ))}
      </div>
    </Card>
  );
}

interface Values { label: string; recipient: string; address: string; is_default: boolean }

function AddressForm({ initial, pending, onSave, onCancel }: {
  initial?: Address;
  pending: boolean;
  onSave: (values: Values) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>({
    label: initial?.label ?? '',
    recipient: initial?.recipient ?? '',
    address: initial?.address ?? '',
    is_default: initial?.is_default ?? false,
  });

  const set = (k: keyof Values) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="border border-ink/20 bg-parch rounded p-3 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name for this address" hint="Shop, Warehouse, Race team…">
          <input value={values.label} onChange={set('label')} maxLength={80} autoFocus />
        </Field>
        <Field label="For the attention of" hint="Optional">
          <input value={values.recipient} onChange={set('recipient')} maxLength={200} />
        </Field>
      </div>
      <Field label="Address">
        <textarea value={values.address} onChange={set('address')} rows={4} maxLength={500}
                  placeholder={'Unit 4, Example Way\nSlough\nSL1 1AA'} />
      </Field>
      <label className="flex items-center gap-2 text-[12px] font-semibold">
        <input type="checkbox" checked={values.is_default}
               onChange={(e) => setValues((v) => ({ ...v, is_default: e.target.checked }))} />
        Use this as my default delivery address
      </label>
      <div className="flex gap-2">
        <Button small kind="accent" disabled={pending} onClick={() => onSave(values)}>
          {pending ? 'Saving…' : 'Save address'}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
