'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Field, Notice, Tag } from '@/components/ui';
import { inviteStaff, revokeStaff } from './actions';

export interface Member {
  email: string;
  role: string;
  note: string | null;
  profileId: string | null;
  fullName: string | null;
  signedIn: boolean;
  sites: string[];
  invited: boolean;
}

const ROLES = [
  ['admin', 'Admin', 'Everything, including this screen and the team list.'],
  ['accounts', 'Accounts', 'Orders, invoices, payments, imports and applications. Every site.'],
  ['ops', 'Ops', 'Packing and receiving, for the sites they are assigned to.'],
] as const;

const ROLE_NAME: Record<string, string> = {
  admin: 'Admin', accounts: 'Accounts', ops: 'Ops',
};

export default function TeamScreen({ members, myEmail }: {
  members: Member[]; myEmail: string;
}) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(''); setMessage('');
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { setMessage(r.message ?? 'Saved'); setConfirming(null); }
      else setError(r.error ?? 'That could not be done');
    });
  }

  function changeRole(email: string, role: string) {
    const fd = new FormData();
    fd.set('email', email); fd.set('role', role);
    run(() => inviteStaff(fd));
  }

  return (
    <div className="space-y-4">
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <Card className="space-y-4">
        <div>
          <h2 className="text-[17px] font-semibold">Add someone</h2>
          <p className="text-[12px] text-mute mt-1">
            They can sign in straight away — the role is waiting for them the first
            time they use the address. Nothing is emailed from here.
          </p>
        </div>
        <form
          action={(fd) => run(() => inviteStaff(fd))}
          className="grid sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-end"
        >
          <Field label="Email">
            <input name="email" type="email" required maxLength={200}
                   placeholder="name@iqsportsupply.com" />
          </Field>
          <Field label="Role">
            <select name="role" defaultValue="ops">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input name="note" maxLength={200} placeholder="Maryport warehouse" />
          </Field>
          <Button kind="accent" type="submit" disabled={pending} className="whitespace-nowrap">
            {pending ? 'Saving…' : 'Add to team'}
          </Button>
        </form>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Status</th><th>Sites</th><th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.email === myEmail;
                return (
                  <tr key={m.email}>
                    <td>
                      <div className="font-medium">{m.fullName ?? m.email}</div>
                      {m.fullName && <div className="text-[12px] text-mute">{m.email}</div>}
                      {m.note && <div className="text-[12px] text-mute">{m.note}</div>}
                    </td>
                    <td>
                      <select
                        value={m.role}
                        disabled={pending || isMe}
                        onChange={(e) => changeRole(m.email, e.target.value)}
                        aria-label={`Role for ${m.email}`}
                        className="!w-auto text-[12px]"
                      >
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      {isMe ? <Tag tone="ink">You</Tag>
                        : m.signedIn ? <Tag tone="green">Signed in</Tag>
                        : <Tag tone="line">Not signed in yet</Tag>}
                      {!m.invited && m.signedIn && !isMe && (
                        <div className="text-[11px] text-mute mt-1">Added directly</div>
                      )}
                    </td>
                    <td className="text-[12px] text-mute">
                      {m.role !== 'ops' ? 'Every site'
                        : m.sites.length ? m.sites.join(', ')
                        : <span className="text-danger">None yet — no queues will show</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {isMe ? (
                        <span className="text-[11px] text-mute">
                          Another admin must change your own access
                        </span>
                      ) : confirming === m.email ? (
                        <span className="inline-flex gap-2 items-center">
                          <span className="text-[12px]">Remove {m.email}?</span>
                          <Button small kind="danger" disabled={pending}
                                  onClick={() => run(() => revokeStaff(m.email))}>
                            Remove
                          </Button>
                          <Button small kind="ghost" disabled={pending}
                                  onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button small kind="ghost" disabled={pending}
                                onClick={() => { setConfirming(m.email); setError(''); setMessage(''); }}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-[15px] font-semibold">What each role reaches</h2>
        <dl className="text-[12px] space-y-1.5">
          {ROLES.map(([v, l, d]) => (
            <div key={v} className="flex gap-2">
              <dt className="font-semibold w-[70px] flex-shrink-0">{ROLE_NAME[v] ?? l}</dt>
              <dd className="text-mute">{d}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12px] text-mute pt-1">
          Ops users see only the sites they are assigned to, which is set on the{' '}
          <Link href="/staff/locations" className="text-flame-text font-semibold">
            Locations
          </Link>{' '}screen. Removing someone leaves their sign-in working but reaching
          nothing, so they can be added back later without losing any history.
        </p>
      </Card>
    </div>
  );
}
