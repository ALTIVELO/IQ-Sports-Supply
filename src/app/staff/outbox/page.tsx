import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { emailEnabled } from '@/lib/email/send';
import { Card, Empty, Notice, PageHeading, Tag } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TONE = { sent: 'green', suppressed: 'line', failed: 'red' } as const;

/**
 * Every outbound message, sent or not. Before an email provider is configured
 * this is where order confirmations and supplier orders land, so the whole
 * workflow is usable and auditable without Resend.
 */
export default async function OutboxPage() {
  await requireStaff();
  const sb = await supabaseServer();

  const { data: messages } = await sb
    .from('email_log')
    .select('id, created_at, kind, to_addrs, cc_addrs, subject, body, status, error')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeading sub="Every message the system has generated. Copy a supplier order straight out of here if you would rather forward it yourself.">
        Outbox
      </PageHeading>

      {!emailEnabled() && (
        <div className="mb-4">
          <Notice tone="info">
            No email provider is configured, so these are held rather than sent — the
            content is exactly what will go out once <code>RESEND_API_KEY</code> is set.
          </Notice>
        </div>
      )}

      {!messages?.length ? (
        <Card><Empty>Nothing sent yet.</Empty></Card>
      ) : (
        <div className="space-y-2.5">
          {messages.map((m) => (
            <Card key={m.id}>
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-3">
                    <Tag tone={TONE[m.status as keyof typeof TONE]}>{m.status}</Tag>
                    <span className="text-[13px] font-semibold">{m.subject}</span>
                    <span className="text-[12px] text-mute">{m.kind.replace(/_/g, ' ')}</span>
                    <span className="text-[12px] text-mute num ml-auto">
                      {fmtDateTime(m.created_at)}
                    </span>
                  </div>
                  <div className="text-[12px] text-mute mt-1">
                    To {m.to_addrs.join(', ') || '—'}
                    {m.cc_addrs?.length ? ` · CC ${m.cc_addrs.join(', ')}` : ''}
                  </div>
                </summary>
                {m.error && <p className="text-[12px] text-danger mt-2">{m.error}</p>}
                <pre className="text-[12px] bg-parch border border-line rounded p-3 mt-3 whitespace-pre-wrap font-sans overflow-x-auto">
                  {m.body}
                </pre>
              </details>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
