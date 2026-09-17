import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { requirePartner } from '@/lib/auth';
import BrandNav from './BrandNav';

/**
 * The brand partner's portal.
 *
 * Deliberately not the client portal with things hidden. A partner is an
 * outsider looking at one shelf: there is no basket, no catalogue, no price
 * list, and nothing on any screen that belongs to another brand. Everything
 * shown comes from a function that filters by the brands on this login, so
 * there is no query a partner can make that widens what they see.
 */
export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePartner();
  // Several brands on one login is allowed — a distributor may represent two —
  // and the name shown is whichever they are looking at.
  const brand = user.brands[0];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ink text-parch">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/brand" aria-label="IQ Sports Supply">
            <Wordmark tone="light" size="sm" />
          </Link>
          <div className="ml-auto text-right leading-tight">
            <div className="text-[12px] text-white font-semibold">
              {user.brands.map((b) => b.brandName).join(' · ')}
            </div>
            <div className="text-[11px] text-[#8DA0B0]">
              {brand.consignment ? 'Consignment partner' : 'Brand partner'}
            </div>
          </div>
          <form action="/api/signout" method="post">
            <button className="text-[11px] text-[#8DA0B0] hover:text-white underline">
              Sign out
            </button>
          </form>
        </div>
        <BrandNav />
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-5">{children}</main>

      <footer className="border-t border-line bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 text-[11px] text-mute">
          These figures cover your own products only. Ask us about anything that looks
          wrong before acting on it — a settlement is agreed, not computed.
        </div>
      </footer>
    </div>
  );
}
