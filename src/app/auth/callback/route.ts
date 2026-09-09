import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionUser, isStaff } from '@/lib/auth';

/** Magic-link landing. Sends each role to the app it belongs in. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next');

  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  if (next) return NextResponse.redirect(`${origin}${next}`);

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (isStaff(user.role)) return NextResponse.redirect(`${origin}/staff`);
  return NextResponse.redirect(`${origin}${user.clientId ? '/portal' : '/pending'}`);
}
