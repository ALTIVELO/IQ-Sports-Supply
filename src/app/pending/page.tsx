import Link from 'next/link';
import { getSessionUser, isStaff } from '@/lib/auth';
import { redirect } from 'next/navigation';

/** Signed in, but not linked to an approved client record — so no access. */
export default async function Pending() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (isStaff(user.role)) redirect('/staff');
  if (user.clientId) redirect('/portal');

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Account not yet active</h1>
        <p className="text-[14px] text-mute mt-3 leading-relaxed">
          You are signed in, but this email address is not linked to an approved trade
          account yet. Every account is reviewed by hand — we will email you as soon
          as yours is open.
        </p>
        <p className="text-[13px] mt-6">
          <Link href="/apply" className="text-cobalt font-semibold">Apply for a trade account</Link>
        </p>
      </div>
    </main>
  );
}
