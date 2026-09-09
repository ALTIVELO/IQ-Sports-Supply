import Link from 'next/link';
import ApplyForm from './ApplyForm';

export const metadata = { title: 'Apply for a trade account — IQ Sports Supply' };

export default function ApplyPage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5 mb-8">
          <span className="bg-cobalt text-white font-extrabold text-base rounded px-[7px] py-[3px]">IQ</span>
          <span className="font-bold text-[17px] tracking-[-0.02em]">Sports Supply</span>
        </Link>

        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">
          Apply for a trade account
        </h1>
        <p className="text-[13px] text-mute mt-2 mb-7 leading-relaxed">
          Every application is reviewed by hand. If we open an account for you we will
          email a sign-in link, and you will see your own pricing straight away.
        </p>

        <ApplyForm />

        <p className="text-[12px] text-mute mt-8">
          Already have an account?{' '}
          <Link href="/login" className="text-cobalt font-semibold">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
