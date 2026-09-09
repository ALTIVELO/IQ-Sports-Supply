'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { saveClient, setClientActive } from './actions';

interface ClientRow {
  id: string; name: string; tier_id: string; email: string | null; phone: string | null;
  vat_no: string | null; address: string | null; vat_exempt: boolean;
  default_location_id: string | null; auth_user_id: string | null; active: boolean;
}
interface Named { id: string; name: string }

const blank = (tierId: string, locationId: string | null) => ({
  name: '', tier_id: tierId, email: '', phone: '', vat_no: '', address: '',
  vat_exempt: false, default_location_id: locationId,
});

export default function ClientsScreen({
  clients, tiers, locations,
}: { clients: ClientRow[]; tiers: Named[]; locations: Named[] }) {
  const [draft, setDraft] = useState(() => blank(tiers[0]?.id ?? '', locations[0]?.id ?? null));
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? '—';
  const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? '—';

  function edit(c: ClientRow) {
    setDraft({
      name: c.name, tier_id: c.tier_id, email: c.email ?? '', phone: c.phone ?? '',
      vat_no: c.vat_no ?? '', address: c.address ?? '', vat_exempt: c.vat_exempt,
      default_location_id: c.default_location_id,
    });
    setEditId(c.id);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function submit() {
    startTransition(async () => {
      const r = await saveClient({ ...draft, id: editId ?? undefined });
      setMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Saved' }
        : { tone: 'error', text: r.error ?? 'Could not save' });
      if (r.ok) {
        setDraft(blank(tiers[0]?.id ?? '', locations[0]?.id ?? null));
        setEditId(null);
        setOpen(false);
      }
    });
  }

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {!open ? (
        <Button small kind="ghost" onClick={() => setOpen(true)}>Add a client</Button>
      ) : (
        <Card accent className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input placeholder="Client name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            <select value={draft.tier_id} onChange={(e) => set('tier_id', e.target.value)}>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input placeholder="Email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
            <input placeholder="Phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
            <input placeholder="VAT number" value={draft.vat_no} onChange={(e) => set('vat_no', e.target.value)} />
            <select
              value={draft.default_location_id ?? ''}
              onChange={(e) => set('default_location_id', e.target.value || null)}
            >
              <option value="">No default site</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
              <input
                type="checkbox" checked={draft.vat_exempt}
                onChange={(e) => set('vat_exempt', e.target.checked)}
              />
              Zero-rated (export)
            </label>
          </div>
          <textarea
            rows={2} placeholder="Delivery / invoice address"
            value={draft.address} onChange={(e) => set('address', e.target.value)}
          />
          <div className="flex gap-2">
            <Button small onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : editId ? 'Save changes' : 'Add client'}
            </Button>
            <Button
              small kind="ghost"
              onClick={() => {
                setDraft(blank(tiers[0]?.id ?? '', locations[0]?.id ?? null));
                setEditId(null);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {clients.length === 0 ? (
          <Empty>No clients yet. Approve a trade account application, or add one here.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Client</th><th>Tier</th><th>Default site</th><th>Email</th>
                  <th>VAT</th><th>Portal</th><th />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                    <td className="font-semibold">{c.name}</td>
                    <td><Tag tone="cobalt">{tierName(c.tier_id)}</Tag></td>
                    <td className="text-mute">{locationName(c.default_location_id)}</td>
                    <td className="text-mute">{c.email ?? '—'}</td>
                    <td className="num">{c.vat_exempt ? 'Zero-rated' : c.vat_no || '—'}</td>
                    <td>
                      {c.auth_user_id
                        ? <Tag tone="green">linked</Tag>
                        : <Tag tone="line">awaiting first sign-in</Tag>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="flex gap-1.5 justify-end">
                        <Button small kind="ghost" onClick={() => edit(c)}>Edit</Button>
                        <Button
                          small kind="ghost" disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const r = await setClientActive(c.id, !c.active);
                              if (!r.ok) setMessage({ tone: 'error', text: r.error ?? 'Failed' });
                            })
                          }
                        >
                          {c.active ? 'Suspend' : 'Restore'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-mute">
        A client gains portal access the first time they sign in with the email address
        held here — that link is made automatically.
      </p>
    </div>
  );
}
