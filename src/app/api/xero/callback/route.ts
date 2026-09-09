import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/auth';
import { xeroExchangeCode } from '@/lib/xero/client';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !['admin', 'accounts'].includes(user.role)) {
    return new NextResponse('Unauthorised', { status: 401 });
  }

  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const jar = await cookies();
  const expected = jar.get('xero_oauth_state')?.value;
  jar.delete('xero_oauth_state');

  if (!code || !state || state !== expected) {
    return NextResponse.redirect(`${origin}/staff/settings?xero=state_mismatch`);
  }

  try {
    await xeroExchangeCode(code, user.id);
    return NextResponse.redirect(`${origin}/staff/settings?xero=connected`);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.redirect(`${origin}/staff/settings?xero=${encodeURIComponent(message)}`);
  }
}
