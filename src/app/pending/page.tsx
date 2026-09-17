import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/Logo';
import { getSessionUser, isStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Account not yet active — IQ Sports Supply' };

/**
 * Signed in, and not attached to a trade account.
 *
 * getSessionUser tries to attach one on every sign-in, so by the time anybody
 * reaches this page it has already looked and failed. That makes the honest
 * reading "the address you signed in with is not the one on your account",
 * which is a thing the reader can act on — the old copy told an approved
 * customer to go and apply again, which was a dead end and the wrong advice.
 */
export default async function Pending() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (isStaff(user.role)) redirect('/staff');
  if (user.clientId) redirect('/portal');

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2.5 mb-8">
          <Wordmark size="lg" />
        </Link>

        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          Account not yet active
        </h1>

        <p className="text-[14px] text-mute mt-3 leading-relaxed">
          You are signed in as{' '}
          <strong className="text-ink">{user.email ?? 'this address'}</strong>, and we
          cannot find a trade account against it.
        </p>

        <div className="border border-line rounded-card bg-white p-4 mt-5 space-y-3">
          <p className="text-[13px] font-semibold">Two things this usually is</p>
          <p className="text-[13px] text-mute leading-relaxed">
            <strong className="text-ink">Your account is under a different address.</strong>{' '}
            Accounts are opened against one email, and a link sent to another will sign
            you in without finding it. Sign out and try the address we correspond with.
          </p>
          <p className="text-[13px] text-mute leading-relaxed">
            <strong className="text-ink">Your application is still with us.</strong>{' '}
            Every one is read by a person. We will email you the moment yours is open.
          </p>
        </div>

        <p className="text-[13px] text-mute mt-5 leading-relaxed">
          If neither fits, ring us or reply to any email from us — we can see your
          account from this end and put it right in a minute.
        </p>

        <div className="flex flex-wrap items-center gap-4 mt-6">
          <form action="/api/signout" method="post">
            <button className="text-[13px] font-semibold border border-line rounded
                               px-4 py-2 bg-white hover:bg-parch">
              Sign out and try another address
            </button>
          </form>
          <Link href="/apply" className="text-[13px] text-flame-text font-semibold">
            Apply for a trade account
          </Link>
        </div>
      </div>
    </main>
  );
}
