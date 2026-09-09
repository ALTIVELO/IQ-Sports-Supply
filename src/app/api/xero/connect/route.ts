import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth';
import { xeroAuthUrl, xeroConfigured } from '@/lib/xero/client';

export async function GET() {
  const user = await getSessionUser();
  if (!user || !['admin', 'accounts'].includes(user.role)) {
    return new NextResponse('Unauthorised', { status: 401 });
  }
  if (!xeroConfigured()) {
    return new NextResponse('Xero is not configured', { status: 400 });
  }

  // CSRF state, checked on the way back.
  const state = randomBytes(16).toString('hex');
  const jar = await cookies();
  jar.set('xero_oauth_state', state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: 600,
  });

  return NextResponse.redirect(xeroAuthUrl(state));
}
