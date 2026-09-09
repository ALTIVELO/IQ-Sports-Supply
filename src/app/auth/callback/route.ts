import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionUser, isStaff } from '@/lib/auth';

/** Magic-link landing. Sends each role to the app it belongs in. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  let exchangeError: string | null = null;

  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) exchangeError = error.message;
  }

  // A sign-in code is single-use, but the link gets opened more than once more
  // often than you would think: mail scanners follow links before the recipient
  // does, browsers prefetch them, and people click twice when a page is slow.
  // Every attempt after the first fails with "invalid or has expired" even
  // though the first one signed them in — so the session, not the exchange, is
  // the source of truth here. Only report the failure if nobody is signed in.
  const user = await getSessionUser();

  if (!user) {
    const query = exchangeError ? `?error=${encodeURIComponent(exchangeError)}` : '';
    return NextResponse.redirect(`${origin}/login${query}`);
  }

  if (next) return NextResponse.redirect(`${origin}${next}`);
  if (isStaff(user.role)) return NextResponse.redirect(`${origin}/staff`);
  return NextResponse.redirect(`${origin}${user.clientId ? '/portal' : '/pending'}`);
}
