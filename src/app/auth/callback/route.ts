import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionUser, isStaff } from '@/lib/auth';

/** Magic-link landing. Sends each role to the app it belongs in. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next');

  // Supabase appends these when its own verification step fails, before the
  // request ever reaches us.
  let failure = searchParams.get('error_description') ?? searchParams.get('error');

  const sb = await supabaseServer();

  if (tokenHash && type) {
    // Token-hash verification carries everything it needs in the link itself,
    // so it survives being opened on a different device or browser from the
    // one that asked for it — asking on a laptop and opening on a phone is
    // the normal case here, not an edge case.
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) failure = error.message;
  } else if (code) {
    // PKCE. The verifier was stored by the browser that requested the link, so
    // this only works when the link is opened in that same browser and on the
    // same origin; anywhere else it fails with "no valid flow state found".
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) failure = error.message;
  }

  // A sign-in link is single-use, but it gets opened more than once more often
  // than you would think: mail scanners follow links before the recipient does,
  // browsers prefetch them, and people click twice when a page is slow. Every
  // attempt after the first fails even though the first one signed them in — so
  // the session, not the verification result, is the source of truth here. Only
  // report the failure if nobody is signed in.
  const user = await getSessionUser();

  if (!user) {
    const query = failure ? `?error=${encodeURIComponent(failure)}` : '';
    return NextResponse.redirect(`${origin}/login${query}`);
  }

  if (next) return NextResponse.redirect(`${origin}${next}`);
  if (isStaff(user.role)) return NextResponse.redirect(`${origin}/staff`);
  return NextResponse.redirect(`${origin}${user.clientId ? '/portal' : '/pending'}`);
}
