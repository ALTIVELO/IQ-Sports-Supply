import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { xeroConfigured } from '@/lib/xero/client';
import { PageHeading } from '@/components/ui';
import InvoicesScreen from './InvoicesScreen';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  await requireStaff();
  const { status } = await searchParams;
  const sb = await supabaseServer();

  let query = sb
    .from('invoices')
    .select(`id, number, type, date, due_date, vat_rate, paid, paid_date, packed, shipped,
             ready_to_pack, superseded, xero_id, xero_status, xero_error, exported,
             clients(name), orders(number), invoice_lines(qty, unit_price)`)
    .eq('superseded', false)
    .order('date', { ascending: false })
    .order('number', { ascending: false })
    .limit(300);

  if (status === 'unpaid') query = query.eq('paid', false);
  if (status === 'paid') query = query.eq('paid', true);
  if (status === 'unsynced') query = query.neq('xero_status', 'synced');

  const { data: invoices } = await query;

  const { data: connection } = await sb.from('xero_connection').select('tenant_id, connected_at').eq('id', 1).maybeSingle();

  return (
    <>
      <PageHeading sub="Every order is invoiced at placement. Back-order invoices carry the date the stock became available. Payment — from Xero or marked here — is what releases an invoice into the packing queue.">
        Invoices
      </PageHeading>
      <InvoicesScreen
        invoices={(invoices ?? []) as never}
        status={status ?? 'all'}
        xeroConfigured={xeroConfigured()}
        xeroConnected={Boolean(connection?.tenant_id)}
      />
    </>
  );
}
