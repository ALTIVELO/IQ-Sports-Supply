import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { redirect } from 'next/navigation';
import { getSessionUser, isStaff } from '@/lib/auth';
import LoginForm from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(isStaff(user.role) ? '/staff' : user.clientId ? '/portal' : '/pending');

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2.5 mb-8">
          <Wordmark size="lg" />
        </Link>

        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Sign in</h1>
        <p className="text-[13px] text-mute mt-2 mb-6">
          We will email you a one-time link — nothing to remember. If you have set a
          password, you can use that instead.
        </p>

        <LoginForm next={next} initialError={error} />

        <p className="text-[12px] text-mute mt-8">
          No account yet?{' '}
          <Link href="/apply" className="text-flame-text font-semibold">Apply for a trade account</Link>
        </p>
      </div>
    </main>
  );
}
