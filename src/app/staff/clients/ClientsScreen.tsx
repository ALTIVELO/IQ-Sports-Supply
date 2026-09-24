'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { saveClient, setClientActive, setClientTier, setTemporaryPassword } from './actions';

interface ClientRow {
  id: string; name: string; tier_id: string; email: string | null; phone: string | null;
  vat_no: string | null; address: string | null; vat_exempt: boolean;
  default_location_id: string | null; auth_user_id: string | null; active: boolean;
}
interface Named { id: string; name: string }
interface Move {
  client_id: string; changed_at: string; by_name: string;
  from_name: string | null; to_name: string | null;
}

const blank = (tierId: string, locationId: string | null) => ({
  name: '', tier_id: tierId, email: '', phone: '', vat_no: '', address: '',
  vat_exempt: false, default_location_id: locationId,
});

export default function ClientsScreen({
  clients, tiers, locations, lastMove = {}, mayPrice = false,
}: {
  clients: ClientRow[]; tiers: Named[]; locations: Named[];
  /** The most recent tier move per client, for the line under the control. */
  lastMove?: Record<string, Move>;
  /** Whether this person may decide what a customer pays. */
  mayPrice?: boolean;
}) {
  const [draft, setDraft] = useState(() => blank(tiers[0]?.id ?? '', locations[0]?.id ?? null));
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  // Held in the page rather than emailed: a password in an inbox outlives the
  // reason it was sent. It is on screen until the page is left.
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
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
      {issued && (
        <Issued name={issued.name} password={issued.password}
                onDone={() => setIssued(null)} />
      )}

      {!open ? (
        <Button small kind="ghost" onClick={() => setOpen(true)}>Add a client</Button>
      ) : (
        <Card accent className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input placeholder="Client name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            {/* Editable here when adding a client — they have no prices yet
                and somebody has to choose one. On an existing client it is
                the row's control that moves them, so that the move is a
                decision of its own and lands in the log. */}
            <select
              value={draft.tier_id}
              disabled={Boolean(editId) && !mayPrice}
              title={editId && !mayPrice
                ? 'Only an admin or accounts can change what a client pays'
                : undefined}
              onChange={(e) => set('tier_id', e.target.value)}
            >
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
                    <td>
                      <TierCell
                        client={c} tiers={tiers} mayPrice={mayPrice}
                        move={lastMove[c.id]}
                        busy={pending}
                        onChange={(tierId) =>
                          startTransition(async () => {
                            setMessage(null);
                            const r = await setClientTier(c.id, tierId);
                            setMessage(r.ok
                              ? {
                                tone: r.from ? 'success' : 'info',
                                text: r.from
                                  ? `${c.name} moved from ${r.from} to `
                                    + `${tierName(tierId)}. Every price they see has changed.`
                                  : `${c.name} was already on ${tierName(tierId)}.`,
                              }
                              : { tone: 'error', text: r.error ?? 'Could not change the tier' });
                          })
                        }
                      />
                    </td>
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
                        {c.active && (
                          <Button
                            small kind="ghost" disabled={pending}
                            title="Sets a password to read out, which they must change on arrival"
                            onClick={() =>
                              startTransition(async () => {
                                setMessage(null);
                                setIssued(null);
                                const r = await setTemporaryPassword(c.id);
                                if (r.ok && r.password) {
                                  setIssued({ name: c.name, password: r.password });
                                } else {
                                  setMessage({ tone: 'error', text: r.error ?? 'Failed' });
                                }
                              })
                            }
                          >
                            Temporary password
                          </Button>
                        )}
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

/**
 * A client's pricing tier, changed where it is read.
 *
 * A select rather than a link to the form, because this is one decision and
 * the form is seven. It confirms first: it is the only control on the screen
 * whose effect is every price that customer sees, and a mis-click on a
 * dropdown is the easiest mistake there is to make and the hardest to notice.
 *
 * Whoever may not change it sees the tier as it always read, not a control
 * that refuses them.
 */
function TierCell({ client, tiers, move, mayPrice, busy, onChange }: {
  client: ClientRow; tiers: Named[]; move?: Move;
  mayPrice: boolean; busy: boolean;
  onChange: (tierId: string) => void;
}) {
  const name = tiers.find((t) => t.id === client.tier_id)?.name ?? '—';

  const since = move && (
    <div className="text-[11px] text-mute mt-0.5 leading-tight">
      {move.from_name ? `${move.from_name} → ${move.to_name}` : move.to_name} ·{' '}
      {new Date(move.changed_at).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' })} · {move.by_name}
    </div>
  );

  if (!mayPrice) {
    return <><Tag tone="accent">{name}</Tag>{since}</>;
  }

  return (
    <>
      <select
        className="text-[12px] min-w-[120px]"
        value={client.tier_id}
        disabled={busy}
        aria-label={`Pricing tier for ${client.name}`}
        onChange={(e) => {
          const tierId = e.target.value;
          if (tierId === client.tier_id) return;
          const to = tiers.find((t) => t.id === tierId)?.name ?? 'that tier';
          // eslint-disable-next-line no-alert
          if (!confirm(
            `Move ${client.name} from ${name} to ${to}?\n\n`
            + 'Every price they see changes immediately, including anything '
            + 'already in their basket. Orders already placed keep the prices '
            + 'they were placed at.',
          )) {
            // The select has already moved to the new value in the DOM; put
            // it back, or it reads as the tier they are not on.
            e.target.value = client.tier_id;
            return;
          }
          onChange(tierId);
        }}
      >
        {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {since}
    </>
  );
}

/**
 * The password, shown once.
 *
 * Read it out, do not send it. It is on screen until this card is dismissed or
 * the page is left, and there is no way to see it again afterwards — setting
 * another one is a button away, and a password you can retrieve later is one
 * that survives the call it was meant for.
 */
export function Issued({ name, password, onDone }: {
  name: string; password: string; onDone: () => void;
}) {
  return (
    <Card accent className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[14px] font-semibold">Temporary password for {name}</h2>
        <Button small kind="ghost" className="ml-auto" onClick={onDone}>Done</Button>
      </div>
      <div className="num text-[22px] font-semibold tracking-[0.04em] select-all
                      bg-parch border border-line rounded px-3 py-2 inline-block">
        {password}
      </div>
      <p className="text-[12px] text-mute max-w-2xl">
        Read it out to them — do not email it. They sign in with their address and this,
        and the first thing they will see is a screen asking them to choose their own.
        It is not shown again after you leave this page; if it goes astray, set another.
      </p>
    </Card>
  );
}
