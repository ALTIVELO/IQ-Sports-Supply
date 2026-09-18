import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import ReturnsQueue, { type StaffReturn } from './ReturnsQueue';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Returns — IQ Sports Supply' };

/**
 * Everything a client has reported, in the order it has to be worked.
 *
 * A return moves requested → approved → received → resolved, and each step is
 * the only thing on offer at that stage, because the database refuses the
 * others anyway. Showing a "raise the credit" button on a return whose goods
 * are still in the post is an invitation to credit stock that never comes back.
 */
export default async function StaffReturns() {
  await requireStaff();
  const sb = await supabaseServer();

  const [{ data: rows }, { data: locations }] = await Promise.all([
    sb.from('returns')
      .select(`id, number, status, wanted, created_at, decided_at, decision_note,
               received_at, resolved_at, client_id,
               clients(name), orders(id, number, date),
               invoices!returns_credit_id_fkey(number),
               return_lines(id, sku, name, qty, reason, note)`)
      .order('created_at', { ascending: false })
      .limit(300),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
  ]);

  const raw = (rows ?? []) as unknown as Record<string, unknown>[];

  /*
   * Which orders could be the replacement for an exchange.
   *
   * Only asked for the clients who have a return waiting to be settled: this
   * is a picker on a handful of cards, not a report, and reading every order
   * in the book to fill three dropdowns is how a queue screen gets slow.
   */
  const needsPicker = [...new Set(raw
    .filter((r) => r.status === 'received')
    .map((r) => String(r.client_id)))];

  const { data: candidates } = needsPicker.length
    ? await sb.from('orders')
        .select('id, number, date, client_id')
        .in('client_id', needsPicker)
        .neq('status', 'cancelled')
        .order('date', { ascending: false })
        .limit(200)
    : { data: [] };

  const ordersFor = new Map<string, { id: string; number: string; date: string }[]>();
  for (const o of (candidates ?? []) as { id: string; number: string; date: string; client_id: string }[]) {
    const list = ordersFor.get(o.client_id) ?? [];
    if (list.length < 15) list.push({ id: o.id, number: o.number, date: o.date });
    ordersFor.set(o.client_id, list);
  }

  const returns: StaffReturn[] = raw.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    status: String(r.status) as StaffReturn['status'],
    wanted: String(r.wanted) as StaffReturn['wanted'],
    createdAt: String(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    receivedAt: (r.received_at as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    clientName: (r.clients as { name: string } | null)?.name ?? '',
    orderNumber: (r.orders as { number: string } | null)?.number ?? '',
    creditNumber: (r.invoices as { number: string } | null)?.number ?? null,
    lines: (r.return_lines as StaffReturn['lines']) ?? [],
    replacementOptions: ordersFor.get(String(r.client_id)) ?? [],
  }));

  return (
    <>
      <PageHeading sub="We take goods back for two reasons: they arrived faulty, or we sent the wrong thing. A wrongly-picked item goes back on the shelf when it is booked in; a faulty one never does.">
        Returns
      </PageHeading>
      <ReturnsQueue returns={returns} locations={locations ?? []} />
    </>
  );
}
