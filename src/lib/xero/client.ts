import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

const AUTH = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
const API = 'https://api.xero.com/api.xro/2.0';
const SCOPES = 'offline_access openid profile email accounting.transactions accounting.contacts accounting.settings';

export const xeroConfigured = () =>
  Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI);

export function xeroAuthUrl(state: string) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID!,
    redirect_uri: process.env.XERO_REDIRECT_URI!,
    scope: SCOPES,
    state,
  });
  return `${AUTH}?${p}`;
}

const basicAuth = () =>
  'Basic ' +
  Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number }

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Xero token exchange failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Completes the OAuth code exchange and stores the connection. */
export async function xeroExchangeCode(code: string, connectedBy: string | null) {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI!,
    }),
  );

  const conn = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
  });
  const tenants = (await conn.json()) as { tenantId: string }[];
  if (!tenants.length) throw new Error('No Xero organisation is connected to this app');

  await supabaseAdmin().from('xero_connection').upsert({
    id: 1,
    tenant_id: tenants[0].tenantId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    connected_at: new Date().toISOString(),
    connected_by: connectedBy,
  });
}

/** A valid access token, refreshing it first if it is close to expiry. */
async function accessToken(): Promise<{ token: string; tenantId: string }> {
  const db = supabaseAdmin();
  const { data } = await db.from('xero_connection').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('Xero is not connected');

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) {
    return { token: data.access_token as string, tenantId: data.tenant_id as string };
  }

  const token = await tokenRequest(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }),
  );
  await db.from('xero_connection').update({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  }).eq('id', 1);

  return { token: token.access_token, tenantId: data.tenant_id as string };
}

export async function xeroFetch(path: string, init: RequestInit = {}) {
  const { token, tenantId } = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function xeroConnection() {
  const { data } = await supabaseAdmin().from('xero_connection').select('*').eq('id', 1).maybeSingle();
  return data;
}

export async function xeroDisconnect() {
  await supabaseAdmin().from('xero_connection').update({
    tenant_id: null, access_token: null, refresh_token: null,
    expires_at: null, connected_at: null,
  }).eq('id', 1);
}
