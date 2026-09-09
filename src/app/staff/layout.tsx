import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import StaffNav, { type NavBadges } from './StaffNav';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const sb = await supabaseServer();

  // Counts for the nav badges — the queues that need someone's attention.
  const [backorders, packing, applications] = await Promise.all([
    sb.from('order_lines').select('bo_qty').gt('bo_qty', 0),
    sb.from('invoices').select('id', { count: 'exact', head: true })
      .eq('paid', true).eq('ready_to_pack', true).eq('packed', false).eq('superseded', false),
    sb.from('account_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  const badges: NavBadges = {
    backorderUnits: (backorders.data ?? []).reduce((a, l) => a + l.bo_qty, 0),
    packing: packing.count ?? 0,
    applications: applications.count ?? 0,
  };

  return (
    <div className="flex min-h-screen">
      <StaffNav badges={badges} role={user.role} email={user.email} />
      <div className="flex-1 min-w-0 px-5 py-7 sm:px-8 lg:px-9">
        <div className="max-w-[1150px]">{children}</div>
      </div>
    </div>
  );
}
