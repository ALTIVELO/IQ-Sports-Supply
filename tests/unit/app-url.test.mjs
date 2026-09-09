const { appUrl } = await import('../../.test-build/lib/app-url.js');
const cases = [
  ['explicit wins over everything',
   { NEXT_PUBLIC_APP_URL: 'https://orders.iqsportssupply.com', VERCEL_URL: 'x.vercel.app' },
   'https://orders.iqsportssupply.com'],
  ['trailing slash trimmed',
   { NEXT_PUBLIC_APP_URL: 'https://orders.iqsportssupply.com/' },
   'https://orders.iqsportssupply.com'],
  ['production uses the stable project URL',
   { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'iq.vercel.app', VERCEL_URL: 'iq-abc123.vercel.app' },
   'https://iq.vercel.app'],
  ['preview links to itself, not production',
   { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'iq.vercel.app', VERCEL_URL: 'iq-abc123.vercel.app' },
   'https://iq-abc123.vercel.app'],
  ['bare host gets https',
   { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'iq.vercel.app' },
   'https://iq.vercel.app'],
  ['no vercel, no explicit → localhost', {}, 'http://localhost:3000'],
  ['empty explicit falls through',
   { NEXT_PUBLIC_APP_URL: '   ', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'iq.vercel.app' },
   'https://iq.vercel.app'],
];
let bad = 0;
for (const [label, env, expected] of cases) {
  for (const k of ['NEXT_PUBLIC_APP_URL','VERCEL_ENV','VERCEL_URL','VERCEL_PROJECT_PRODUCTION_URL']) delete process.env[k];
  Object.assign(process.env, env);
  const got = appUrl();
  const ok = got === expected;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label} → ${got}${ok ? '' : ` (expected ${expected})`}`);
}
process.exit(bad ? 1 : 0);
