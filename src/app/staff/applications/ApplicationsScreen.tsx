'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { approveApplication, rejectApplication } from './actions';
import type { AccountRequest } from '@/lib/types';

interface Named { id: string; name: string }

export default function ApplicationsScreen({
  requests, tiers, locations,
}: { requests: AccountRequest[]; tiers: Named[]; locations: Named[] }) {
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const pending = requests.filter((r) => r.status === 'pending');
  const reviewed = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-5">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
          Awaiting review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <Card><Empty>No applications waiting.</Empty></Card>
        ) : (
          <div className="space-y-2.5">
            {pending.map((r) => (
              <RequestCard
                key={r.id} request={r} tiers={tiers} locations={locations}
                onMessage={setMessage}
              />
            ))}
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">Reviewed</h2>
          <Card>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr><th>Company</th><th>Contact</th><th>Applied</th><th>Outcome</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {reviewed.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.company_name}</td>
                      <td className="text-mute">{r.contact_name} · {r.email}</td>
                      <td className="num whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td>
                        <Tag tone={r.status === 'approved' ? 'green' : 'line'}>{r.status}</Tag>
                      </td>
                      <td className="text-mute">{r.review_note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function RequestCard({
  request, tiers, locations, onMessage,
}: {
  request: AccountRequest; tiers: Named[]; locations: Named[];
  onMessage: (m: { tone: 'error' | 'success'; text: string }) => void;
}) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [notify, setNotify] = useState(true);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Done' }
        : { tone: 'error', text: r.error ?? 'Something went wrong' });
    });

  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[15px] font-bold">{request.company_name}</span>
        {request.business_type && <Tag tone="line">{request.business_type}</Tag>}
        <span className="text-[12px] text-mute num ml-auto">{fmtDate(request.created_at)}</span>
      </div>

      <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 mt-3 text-[12px]">
        <Detail label="Contact" value={request.contact_name} />
        <Detail label="Email" value={request.email} />
        <Detail label="Phone" value={request.phone} />
        <Detail label="VAT number" value={request.vat_no} />
        <Detail label="Website" value={request.website} />
        <Detail label="Address" value={request.address} />
      </dl>

      {request.message && (
        <p className="text-[12px] text-mute mt-3 border-l-2 border-line pl-3 italic">
          {request.message}
        </p>
      )}

      {!rejecting ? (
        <div className="flex flex-wrap items-end gap-2 mt-4 pt-3 border-t border-line">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Pricing tier</span>
            <select value={tierId} onChange={(e) => setTierId(e.target.value)} className="w-[150px]">
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Default fulfilment site</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-[170px]">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <Button
            small kind="cobalt" disabled={pending || !tierId || !locationId}
            onClick={() => run(() => approveApplication({ requestId: request.id, tierId, locationId }))}
          >
            {pending ? 'Approving…' : 'Approve & send welcome'}
          </Button>
          <Button small kind="ghost" onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      ) : (
        <div className="mt-4 pt-3 border-t border-line space-y-2">
          <label className="text-[12px] block">
            <span className="block font-semibold mb-1">Reason (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email the applicant
          </label>
          <div className="flex gap-2">
            <Button
              small kind="danger" disabled={pending}
              onClick={() => run(() => rejectApplication({ requestId: request.id, note: note || undefined, notify }))}
            >
              {pending ? 'Rejecting…' : 'Confirm rejection'}
            </Button>
            <Button small kind="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-mute">{label}</dt>
      <dd className="font-medium break-words">{value || '—'}</dd>
    </div>
  );
}
