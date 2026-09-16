'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button, Card, Empty, Field, Notice, Tag } from '@/components/ui';
import {
  saveGroup, setGroupActive, deleteGroup,
  saveStep, deleteStep, addOptions, deleteOption,
} from './actions';

export interface ProductLite {
  id: string; sku: string; name: string; brand: string | null; active: boolean;
}
interface Option { id: string; product_id: string; label: string | null; sort: number }
interface Step {
  id: string; name: string; hint: string | null; qty: number;
  required: boolean; sort: number;
  product_group_options: Option[];
}
export interface Group {
  id: string; slug: string; name: string; brand: string | null;
  description: string | null; category_id: string | null;
  image_url: string | null; active: boolean; sort: number;
  product_group_steps: Step[];
}
interface Category { id: string; name: string; parent_id: string | null; sort: number }

type Msg = { tone: 'error' | 'success'; text: string } | null;

export default function GroupsScreen({ groups, products, categories }: {
  groups: Group[]; products: ProductLite[]; categories: Category[];
}) {
  const [message, setMessage] = useState<Msg>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const bySku = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const grouped = useMemo(() => categories
    .filter((c) => c.parent_id === null)
    .map((g) => ({ g, children: categories.filter((c) => c.parent_id === g.id) })), [categories]);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok
        ? (r.message ? { tone: 'success', text: r.message } : null)
        : { tone: 'error', text: r.error ?? 'That could not be saved' });
      if (r.ok) setCreating(false);
    });
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {creating ? (
        <GroupForm
          grouped={grouped} pending={pending}
          onCancel={() => setCreating(false)}
          onSave={(v) => run(() => saveGroup(v))}
        />
      ) : (
        <Button kind="accent" onClick={() => { setCreating(true); setMessage(null); }}>
          New variant or build
        </Button>
      )}

      {groups.length === 0 && !creating && (
        <Card>
          <Empty>
            Nothing set up yet. A tyre in five sizes needs one choice called Size; a
            groupset needs one choice per component.
          </Empty>
        </Card>
      )}

      {groups.map((g) => {
        const open = openId === g.id;
        const optionCount = g.product_group_steps
          .reduce((a, s) => a + s.product_group_options.length, 0);
        return (
          <Card key={g.id} className={g.active ? '' : 'opacity-60'}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setOpenId(open ? null : g.id)}
                className="text-[15px] font-semibold hover:text-flame-text text-left"
              >
                {open ? '▾' : '▸'} {g.name}
              </button>
              {g.brand && <span className="text-[12px] text-mute">{g.brand}</span>}
              <Tag tone="line">
                {g.product_group_steps.length === 1
                  ? 'Variant' : `Build · ${g.product_group_steps.length} choices`}
              </Tag>
              <span className="text-[12px] text-mute num">{optionCount} options</span>
              {!g.active && <Tag tone="line">Hidden</Tag>}
              <span className="text-[11px] text-mute num ml-auto">/portal/build/{g.slug}</span>
              <Button small kind="ghost" disabled={pending}
                      onClick={() => run(() => setGroupActive(g.id, !g.active))}>
                {g.active ? 'Hide' : 'Show'}
              </Button>
            </div>

            {open && (
              <div className="mt-4 pt-4 border-t border-line space-y-4">
                <StepEditor
                  group={g} products={products} bySku={bySku}
                  pending={pending} run={run}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button small kind="danger" disabled={pending}
                          onClick={() => {
                            if (confirm(`Delete "${g.name}"? No products are affected.`)) {
                              run(() => deleteGroup(g.id));
                            }
                          }}>
                    Delete this group
                  </Button>
                  <span className="text-[11px] text-mute self-center">
                    Deleting removes the choices only. Every SKU stays in the catalogue.
                  </span>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function GroupForm({ grouped, pending, onSave, onCancel }: {
  grouped: { g: Category; children: Category[] }[];
  pending: boolean;
  onSave: (v: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');

  return (
    <Card className="space-y-4">
      <h2 className="text-[17px] font-semibold">New variant or build</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Name" hint="What the customer sees, e.g. Continental GP5000">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Brand">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Collection" hint="Where it appears in the customer's catalogue">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— none —</option>
            {grouped.map(({ g, children }) => (
              <optgroup key={g.id} label={g.name}>
                <option value={g.id}>{g.name} (whole department)</option>
                {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description" hint="Optional — shown above the choices">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  rows={2} maxLength={2000} />
      </Field>
      <div className="flex gap-2">
        <Button kind="accent" disabled={pending || name.trim().length < 2}
                onClick={() => onSave({
                  name, brand, description, category_id: categoryId || null,
                })}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
        <Button kind="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-[11px] text-mute">
        One choice makes a variant picker, several make a builder. Add them next.
      </p>
    </Card>
  );
}

function StepEditor({ group, products, bySku, pending, run }: {
  group: Group; products: ProductLite[];
  bySku: Map<string, ProductLite>;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState(1);
  const steps = [...group.product_group_steps].sort((a, b) => a.sort - b.sort);

  return (
    <div className="space-y-3">
      {steps.length === 0 && (
        <Empty>
          No choices yet. A tyre needs one, called something like &ldquo;Size&rdquo;.
        </Empty>
      )}

      {steps.map((s, i) => (
        <div key={s.id} className="border border-line rounded p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{i + 1}. {s.name}</span>
            {s.qty > 1 && <Tag tone="line">{s.qty} per build</Tag>}
            {!s.required && <Tag tone="line">Optional</Tag>}
            <span className="text-[12px] text-mute num">
              {s.product_group_options.length} option
              {s.product_group_options.length === 1 ? '' : 's'}
            </span>
            <Button small kind="ghost" className="ml-auto" disabled={pending}
                    onClick={() => run(() => deleteStep(s.id))}>
              Remove choice
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {s.product_group_options
              .sort((a, b) => a.sort - b.sort)
              .map((o) => {
                const p = bySku.get(o.product_id);
                return (
                  <span key={o.id}
                        className="inline-flex items-center gap-1.5 border border-line rounded
                                   bg-parch px-2 py-1 text-[12px]">
                    <span className="num font-semibold">{p?.sku ?? '—'}</span>
                    {o.label && <span className="text-mute">{o.label}</span>}
                    <button onClick={() => run(() => deleteOption(o.id))}
                            disabled={pending}
                            aria-label={`Remove ${p?.sku ?? 'option'}`}
                            className="text-mute hover:text-danger leading-none">×</button>
                  </span>
                );
              })}
          </div>

          <OptionPicker
            products={products}
            already={new Set(s.product_group_options.map((o) => o.product_id))}
            pending={pending}
            onAdd={(ids, label) => run(() => addOptions(s.id, ids, label))}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <Field label="Add a choice" hint="Size, Chainset, Cassette, Rotors…">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="How many per build">
          <input type="number" min={1} max={99} value={newQty} className="num w-20"
                 onChange={(e) => setNewQty(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Button small disabled={pending || !newName.trim()}
                onClick={() => {
                  run(() => saveStep({
                    group_id: group.id, name: newName, qty: newQty,
                    required: true, sort: steps.length,
                  }));
                  setNewName(''); setNewQty(1);
                }}>
          Add choice
        </Button>
      </div>
    </div>
  );
}

function OptionPicker({ products, already, pending, onAdd }: {
  products: ProductLite[]; already: Set<string>; pending: boolean;
  onAdd: (ids: string[], label?: string) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return products
      .filter((p) => !already.has(p.id))
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, products, already]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Find SKUs to offer" hint="Search by SKU, name or brand">
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="GP5000, CS-R8100…" className="min-w-[220px]" />
        </Field>
        {picked.size === 1 && (
          <Field label="Label" hint='Optional, e.g. "700x28"'>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
          </Field>
        )}
        {picked.size > 0 && (
          <Button small kind="accent" disabled={pending}
                  onClick={() => {
                    onAdd([...picked], picked.size === 1 ? label : undefined);
                    setPicked(new Set()); setLabel(''); setQ('');
                  }}>
            Add {picked.size} option{picked.size === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {matches.length > 0 && (
        <div className="border border-line rounded divide-y divide-line max-h-[200px] overflow-y-auto">
          {matches.map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-[12px] cursor-pointer hover:bg-parch">
              <input
                type="checkbox" checked={picked.has(p.id)}
                onChange={() => setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                  return next;
                })}
              />
              <span className="num font-semibold w-[110px]">{p.sku}</span>
              <span className="flex-1 min-w-0">{p.name}</span>
              <span className="text-mute">{p.brand}</span>
            </label>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && matches.length === 0 && (
        <p className="text-[12px] text-mute">No SKUs match, or they are already offered here.</p>
      )}
    </div>
  );
}
