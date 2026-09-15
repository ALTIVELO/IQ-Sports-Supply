import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { CartProvider } from './CartContext';
import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import PortalNav from './PortalNav';
import BasketButton from './BasketButton';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: client } = await sb
    .from('clients').select('name, tiers(name)').eq('id', user.clientId).single();

  return (
    <CartProvider>
    <div className="min-h-screen flex flex-col">
      <header className="bg-ink text-parch">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2.5 sm:gap-3">
          <Link href="/portal" aria-label="IQ Sports Supply">
            <Wordmark tone="light" size="sm" />
          </Link>
          <div className="ml-auto text-right leading-tight hidden sm:block">
            <div className="text-[12px] text-white font-semibold">{client?.name}</div>
            <div className="text-[11px] text-[#8DA0B0]">
              {(client?.tiers as unknown as { name: string } | null)?.name} pricing
            </div>
          </div>
          <BasketButton />
          <form action="/api/signout" method="post">
            <button className="text-[11px] text-[#8DA0B0] hover:text-white underline">
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
    </CartProvider>
  );
}
