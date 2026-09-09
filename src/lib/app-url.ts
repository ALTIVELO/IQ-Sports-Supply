/**
 * The public base URL of this deployment.
 *
 * NEXT_PUBLIC_APP_URL wins when set. Otherwise Vercel's own variables are used,
 * which removes the chicken-and-egg on a first deploy: you cannot know the URL
 * until the project exists, but emails and the application-review link need it.
 * It also means preview deployments link to themselves rather than to
 * production.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // VERCEL_PROJECT_PRODUCTION_URL is stable across deploys; VERCEL_URL is the
  // per-deployment host, which is what a preview should use.
  const vercel =
    process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
      : process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}
