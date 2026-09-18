import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, PageHeading } from '@/components/ui';
import ReturnsList, { type ReturnRow } from './ReturnsList';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Returns — IQ Sports Supply' };

/**
 * Everything the client has reported, and where each one has got to.
 *
 * Raising one starts from the order it is about, on the order history page,
 * because a return is always about a particular line of a particular order
 * and asking somebody to find the order number first is asking them to do the
 * software's job.
 */
export default async function Returns() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: rows }, { data: settings }] = await Promise.all([
    sb.from('returns')
      .select(`id, number, status, wanted, created_at, decided_at, decision_note,
               received_at, resolved_at,
               orders(number), invoices!returns_credit_id_fkey(number),
               return_lines(id, sku, name, qty, reason, note)`)
      .eq('client_id', user.clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('settings').select('returns_days').eq('id', 1).single(),
  ]);

  const returns: ReturnRow[] = ((rows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    number: String(r.number),
    status: String(r.status) as ReturnRow['status'],
    wanted: String(r.wanted) as ReturnRow['wanted'],
    createdAt: String(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    receivedAt: (r.received_at as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    orderNumber: (r.orders as { number: string } | null)?.number ?? '',
    creditNumber: (r.invoices as { number: string } | null)?.number ?? null,
    lines: (r.return_lines as ReturnRow['lines']) ?? [],
  }));

  return (
    <>
      <PageHeading sub={`We take goods back when they arrive faulty or when we sent the wrong thing — within ${settings?.returns_days ?? 30} days of dispatch. Report one from the order it is about.`}>
        Returns
      </PageHeading>

      {returns.length === 0 ? (
        <Card>
          <Empty>
            Nothing reported. If something arrived faulty or is not what you ordered,
            open the order on your{' '}
            <Link href="/portal/history" className="text-flame-text font-semibold underline">
              order history
            </Link>{' '}and tell us there.
          </Empty>
        </Card>
      ) : (
        <ReturnsList returns={returns} />
      )}
    </>
  );
}
