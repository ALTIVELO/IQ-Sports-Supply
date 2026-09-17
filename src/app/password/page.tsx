import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/Logo';
import { getSessionUser, isStaff } from '@/lib/auth';
import PasswordGate from './PasswordGate';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Choose a password — IQ Sports Supply' };

/**
 * The one screen a temporary password can reach.
 *
 * It deliberately does not use requireClient or requireStaff: those send people
 * here, and a page that sent them here in turn would be a loop. Anyone who does
 * not need to be here is sent on to wherever they were going.
 */
export default async function PasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const home = isStaff(user.role) ? '/staff' : user.clientId ? '/portal' : '/pending';
  if (!user.mustChangePassword) redirect(home);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2.5 mb-8">
          <Wordmark size="lg" />
        </Link>

        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Choose a password</h1>
        <p className="text-[13px] text-mute mt-2 mb-6">
          You are signed in on a temporary password that somebody here set for you. Pick
          your own and we will not ask again. Afterwards you can sign in with it, or with
          a one-time link we email to {user.email ?? 'your address'} — whichever suits.
        </p>

        <PasswordGate email={user.email} next={home} />

        <form action="/api/signout" method="post" className="mt-8">
          <button className="text-[12px] text-mute underline">
            Sign out instead
          </button>
        </form>
      </div>
    </main>
  );
}
