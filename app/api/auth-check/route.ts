import { NextResponse } from 'next/server';
import { cleanKey, cleanSupabaseUrl, cleanValue } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Public configuration self-check. Reports only yes/no facts, lengths, hostname, key role label and HTTP statuses — never a key value. */
function keyInfo(k: string): { format: string; role?: string; ref?: string } {
  if (!k) return { format: 'missing' };
  if (k.startsWith('sb_publishable_')) return { format: 'publishable', role: 'anon' };
  if (k.startsWith('sb_secret_')) return { format: 'secret', role: 'service_role' };
  try { const p = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8')); return { format: 'jwt', role: p.role, ref: p.ref }; } catch { return { format: 'unrecognised' }; }
}
const dirty = (raw: string | undefined) => !!raw && raw !== cleanValue(raw);

async function probe(url: string, init: RequestInit) {
  try {
    const r = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return { reached: true, status: r.status };
  } catch (e: any) {
    const m = String(e?.message || '') + ' ' + String(e?.cause?.code || e?.cause?.message || '');
    return { reached: false, status: null as number | null, reason: /header/i.test(m) ? 'API key contains an invalid character (e.g. a line break)' : /ENOTFOUND|getaddrinfo/i.test(m) ? 'host name not found' : /timeout|abort/i.test(m) ? 'timed out' : /ECONN|refused|reset/i.test(m) ? 'connection refused/reset' : `request failed (${e?.name || 'error'}${e?.cause?.code ? ' ' + e.cause.code : ''})` };
  }
}

export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, rawSvc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = cleanSupabaseUrl(rawUrl), anon = cleanKey(rawAnon), svc = cleanKey(rawSvc);
  const host = (() => { try { return new URL(url).hostname; } catch { return null; } })();
  const a = keyInfo(anon), s = keyInfo(svc);
  const problems: string[] = [], fixedAutomatically: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is missing on the server.');
  else if (!host || !/\.supabase\.(co|in|com)$/.test(host)) problems.push('NEXT_PUBLIC_SUPABASE_URL does not look like https://<project>.supabase.co');
  if (dirty(rawUrl) || (rawUrl && /\/(rest|auth)\/v1|\/$/.test(rawUrl.trim()))) fixedAutomatically.push('URL had extra spaces/quotes/slash/path — cleaned by the app.');
  if (dirty(rawAnon)) fixedAutomatically.push('Anon key had extra spaces/quotes/line break — cleaned by the app.');
  if (dirty(rawSvc)) fixedAutomatically.push('Service-role key had extra spaces/quotes/line break — cleaned by the app.');
  if (!anon) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing on the server.');
  else if (a.role && a.role !== 'anon') problems.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY holds a "${a.role}" key; it must be the anon / publishable key.`);
  else if (a.format === 'unrecognised') problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid Supabase key.');
  if (!svc) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing (needed for Login-ID sign-in and teacher activation).');
  else if (s.role && s.role !== 'service_role') problems.push(`SUPABASE_SERVICE_ROLE_KEY holds a "${s.role}" key; it must be the service_role / secret key.`);
  if (a.ref && host && !host.startsWith(a.ref + '.')) problems.push('The anon key belongs to a DIFFERENT Supabase project than the URL.');
  if (s.ref && host && !host.startsWith(s.ref + '.')) problems.push('The service-role key belongs to a DIFFERENT Supabase project than the URL.');

  let settings: any = null, passwordGrant: any = null;
  if (url && anon && host) {
    settings = await probe(`${url}/auth/v1/settings`, { headers: { apikey: anon } });
    if (settings.reached && settings.status !== 200) problems.push(`Supabase answered HTTP ${settings.status} to /auth/v1/settings — the anon key was not accepted.`);
    if (!settings.reached) problems.push(`The server could not reach Supabase: ${settings.reason}.`);
    // Proves the sign-in endpoint accepts the key: a made-up login must come back "400 invalid credentials", not 401/403.
    passwordGrant = await probe(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'auth-check@invalid.example', password: 'not-a-real-password' }) });
    if (passwordGrant.reached) passwordGrant.expected = passwordGrant.status === 400 ? 'OK (invalid credentials, key accepted)' : `unexpected HTTP ${passwordGrant.status}`;
  }
  return NextResponse.json({
    ok: problems.length === 0, problems, fixedAutomatically,
    urlExists: !!url, urlHostname: host, anonKeyExists: !!anon, anonKeyType: a.format, anonKeyRole: a.role ?? null,
    serviceKeyExists: !!svc, serviceKeyRole: s.role ?? null,
    settingsEndpoint: settings, signInEndpoint: passwordGrant,
    note: 'No key values are ever shown. After changing Vercel variables, Redeploy.',
  }, { headers: { 'cache-control': 'no-store' } });
}
