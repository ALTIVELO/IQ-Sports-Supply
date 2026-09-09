import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Read statically: Next inlines process.env.NEXT_PUBLIC_* at build time only
// for direct member access, so process.env[name] would always be undefined here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PUBLIC_PATHS = ['/', '/apply', '/login', '/pending'];
const PUBLIC_PREFIXES = ['/auth/', '/api/xero/'];

const isPublic = (path: string) =>
  PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

/**
 * Refreshes the Supabase session cookie on every request and keeps signed-out
 * traffic out of the app. Nothing beyond the application page and login is
 * reachable without an account.
 *
 * This runs before every request, so it must never throw: an exception here
 * takes down every route, including the public application page.
 */
export async function middleware(request: NextRequest) {
  // NEXT_PUBLIC_* values are baked in when the app is built, so setting them
  // after a deploy has no effect until it is rebuilt. Say so plainly rather
  // than crashing with a platform-level 500 that explains nothing.
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) return configurationNeeded(missing);

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: CookieOptions }[]) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user && !isPublic(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  } catch {
    // Supabase unreachable, or a malformed session cookie. Treat the request as
    // signed out rather than failing it: the page-level guards still hold, so
    // this can only ever send someone to the login page, never past it.
    if (!isPublic(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

/** Shown instead of a 500 when the app has not been given its Supabase keys. */
function configurationNeeded(missing: string[]) {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configuration needed</title>
<style>
  body{font-family:system-ui,sans-serif;background:#F2F4F6;color:#16222E;
       margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #DCE2E8;border-radius:6px;padding:28px;max-width:560px}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:14px;line-height:1.6;color:#5B6B79;margin:0 0 12px}
  code{background:#F2F4F6;border:1px solid #DCE2E8;border-radius:3px;padding:1px 5px;font-size:13px}
  li{font-size:14px;line-height:1.8;color:#5B6B79}
</style></head><body><div class="card">
<h1>Configuration needed</h1>
<p>This deployment is missing ${missing.length === 1 ? 'an environment variable' : 'environment variables'}:</p>
<ul>${missing.map((m) => `<li><code>${m}</code></li>`).join('')}</ul>
<p>Add ${missing.length === 1 ? 'it' : 'them'} in your hosting project's environment settings,
then <strong>redeploy</strong>. Values prefixed <code>NEXT_PUBLIC_</code> are compiled into the
build, so adding them to an existing deployment has no effect until it is rebuilt.</p>
<p>The Supabase values are under Project Settings → API.</p>
</div></body></html>`;

  return new NextResponse(body, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
