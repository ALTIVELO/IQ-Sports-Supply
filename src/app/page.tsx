import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, isStaff } from '@/lib/auth';

/**
 * The public site is only the application page and a login link. Nothing —
 * catalogue, prices, stock — is visible without an approved account.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(isStaff(user.role) ? '/staff' : '/portal');

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-2.5 mb-8">
            <span className="bg-cobalt text-white font-extrabold text-base rounded px-[7px] py-[3px] tracking-[0.02em]">IQ</span>
            <span className="font-bold text-[17px] tracking-[-0.02em]">Sports Supply</span>
          </div>

          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">
            Trade ordering
          </h1>
          <p className="text-[14px] text-mute mt-3 leading-relaxed">
            Cycling components at trade prices, for shops, clubs and distributors.
            Accounts are opened by application — once approved you can order at your
            own tier prices, track every order and download every invoice.
          </p>

          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              href="/apply"
              className="bg-cobalt text-white text-[13px] font-semibold rounded px-5 py-2.5 hover:bg-[#1c37a8]"
            >
              Apply for a trade account
            </Link>
            <Link
              href="/login"
              className="border border-line bg-white text-[13px] font-semibold rounded px-5 py-2.5 hover:bg-parch"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

      <footer className="border-t border-line px-6 py-5 text-[12px] text-mute">
        IQ Sports Supply Ltd · 2 Carnegie Court, The Broadway, Farnham Common, Slough SL2 3GQ
      </footer>
    </main>
  );
}
