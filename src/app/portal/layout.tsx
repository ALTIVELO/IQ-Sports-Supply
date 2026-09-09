import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import PortalNav from './PortalNav';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: client } = await sb
    .from('clients').select('name, tiers(name)').eq('id', user.clientId).single();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ink text-parch">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="bg-cobalt text-white font-extrabold text-sm rounded px-1.5 py-0.5">IQ</span>
            <span className="font-bold text-[15px] text-white tracking-[-0.02em]">Sports Supply</span>
          </Link>
          <div className="ml-auto text-right leading-tight">
            <div className="text-[12px] text-white font-semibold">{client?.name}</div>
            <div className="text-[11px] text-[#8DA0B0]">
              {(client?.tiers as unknown as { name: string } | null)?.name} pricing
            </div>
          </div>
          <form action="/api/signout" method="post">
            <button className="text-[11px] text-[#8DA0B0] hover:text-white underline ml-2">
              Sign out
            </button>
          </form>
        </div>
        <PortalNav />
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6">{children}</main>

      <footer className="border-t border-line px-6 py-4 text-[11px] text-mute text-center">
        IQ Sports Supply Ltd
      </footer>
    </div>
  );
}
