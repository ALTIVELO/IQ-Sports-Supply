import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  const url = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(new URL('/login', url), { status: 303 });
}
