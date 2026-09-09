'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { saveLocation, setOpsLocations, setUserRole } from './actions';
import type { Role } from '@/lib/types';

interface Loc { id: string; name: string; address: string | null; active: boolean }
interface Profile { id: string; email: string | null; full_name: string | null; role: Role }

const ROLES: Role[] = ['admin', 'accounts', 'ops', 'client'];

export default function LocationsScreen({
  locations, profiles, assignments, unitsByLocation,
}: {
  locations: Loc[]; profiles: Profile[];
  assignments: { profile_id: string; location_id: string }[];
  unitsByLocation: Record<string, number>;
}) {
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [draft, setDraft] = useState({ name: '', address: '' });
  const [pending, startTransition] = useTransition();

  const staff = profiles.filter((p) => p.role !== 'client');

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card className="space-y-3">
        <div className="text-[12px] font-semibold">Add a fulfilment site</div>
        <div className="grid sm:grid-cols-[200px_1fr_auto] gap-2">
          <input
            placeholder="Site name" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            placeholder="Address" value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
          <Button
            small disabled={pending || !draft.name.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await saveLocation({ ...draft, active: true });
                setMessage(r.ok
                  ? { tone: 'success', text: r.message ?? 'Added' }
                  : { tone: 'error', text: r.error ?? 'Failed' });
                if (r.ok) setDraft({ name: '', address: '' });
              })
            }
          >
            Add site
          </Button>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr><th>Site</th><th>Address</th><th className="text-right">Units in stock</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className={l.active ? '' : 'opacity-50'}>
                  <td className="font-semibold">{l.name}</td>
                  <td className="text-mute">{l.address ?? '—'}</td>
                  <td className="num text-right">{unitsByLocation[l.id] ?? 0}</td>
                  <td>{l.active ? <Tag tone="green">active</Tag> : <Tag tone="line">inactive</Tag>}</td>
                  <td className="text-right">
                    <Button
                      small kind="ghost" disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await saveLocation({
                            id: l.id, name: l.name, address: l.address ?? '', active: !l.active,
                          });
                          if (!r.ok) setMessage({ tone: 'error', text: r.error ?? 'Failed' });
                        })
                      }
                    >
                      {l.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div>
        <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
          Staff users
        </h2>
        {staff.length === 0 ? (
          <Card><Empty>No staff users yet.</Empty></Card>
        ) : (
          <div className="space-y-2.5">
            {staff.map((p) => (
              <StaffRow
                key={p.id} profile={p} locations={locations}
                assigned={assignments.filter((a) => a.profile_id === p.id).map((a) => a.location_id)}
                onMessage={setMessage}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-mute mt-2">
          A user appears here once they have signed in at least once. New sign-ins start
          as <code>client</code> and see nothing until you give them a staff role.
        </p>
      </div>
    </div>
  );
}

function StaffRow({
  profile, locations, assigned, onMessage,
}: {
  profile: Profile; locations: Loc[]; assigned: string[];
  onMessage: (m: { tone: 'error' | 'success'; text: string }) => void;
}) {
  const [selected, setSelected] = useState<string[]>(assigned);
  const [pending, startTransition] = useTransition();
  const dirty =
    selected.length !== assigned.length || selected.some((id) => !assigned.includes(id));

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold">{profile.full_name || profile.email}</span>
        {profile.full_name && <span className="text-[12px] text-mute">{profile.email}</span>}
        <select
          className="w-[130px] ml-auto" value={profile.role} disabled={pending}
          onChange={(e) =>
            startTransition(async () => {
              const r = await setUserRole(profile.id, e.target.value as Role);
              onMessage(r.ok
                ? { tone: 'success', text: r.message ?? 'Updated' }
                : { tone: 'error', text: r.error ?? 'Failed' });
            })
          }
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {profile.role === 'ops' && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-2">
            Assigned sites
          </div>
          <div className="flex flex-wrap gap-3">
            {locations.map((l) => (
              <label key={l.id} className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox" checked={selected.includes(l.id)} onChange={() => toggle(l.id)}
                />
                {l.name}
              </label>
            ))}
            {dirty && (
              <Button
                small kind="cobalt" disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await setOpsLocations(profile.id, selected);
                    onMessage(r.ok
                      ? { tone: 'success', text: r.message ?? 'Saved' }
                      : { tone: 'error', text: r.error ?? 'Failed' });
                  })
                }
              >
                Save
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
