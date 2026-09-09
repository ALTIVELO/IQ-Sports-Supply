import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  // Derived from the request rather than NEXT_PUBLIC_APP_URL, so signing out
  // works on any deployment — preview URLs included — even if that is unset.
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
