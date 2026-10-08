import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Public configuration self-check. Reveals only yes/no facts and the key's role label — never a key, URL path or secret. */
function jwtInfo(k?: string): { format: string; role?: string; ref?: string } {
  if (!k) return { format: 'missing' };
  if (k.startsWith('sb_publishable_')) return { format: 'publishable', role: 'anon' };
  if (k.startsWith('sb_secret_')) return { format: 'secret', role: 'service_role' };
  try { const p = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8')); return { format: 'jwt', role: p.role, ref: p.ref }; } catch { return { format: 'unrecognised' }; }
}
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const host = (() => { try { return new URL(url!).hostname; } catch { return null; } })();
  const a = jwtInfo(anon), s = jwtInfo(svc);
  const problems: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is missing.');
  else if (!host || !/\.supabase\.(co|in)$/.test(host)) problems.push('NEXT_PUBLIC_SUPABASE_URL does not look like https://<project>.supabase.co (no extra path, no trailing text).');
  if (!anon) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.');
  else if (a.role && a.role !== 'anon') problems.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY holds a "${a.role}" key. It must be the anon / publishable key.`);
  else if (a.format === 'unrecognised') problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid Supabase key (check for spaces or quotes).');
  if (!svc) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing (needed for Login-ID sign-in, teacher activation, invites).');
  else if (s.role && s.role !== 'service_role') problems.push(`SUPABASE_SERVICE_ROLE_KEY holds a "${s.role}" key. It must be the service_role / secret key.`);
  if (a.ref && host && !host.startsWith(a.ref + '.')) problems.push('The anon key belongs to a DIFFERENT Supabase project than NEXT_PUBLIC_SUPABASE_URL.');
  if (s.ref && host && !host.startsWith(s.ref + '.')) problems.push('The service-role key belongs to a DIFFERENT Supabase project than NEXT_PUBLIC_SUPABASE_URL.');
  // Reachability + key acceptance (anon key only; no user data involved)
  let reachable: boolean | null = null, keyAccepted: boolean | null = null;
  if (url && anon && !problems.some((p) => p.includes('URL'))) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: anon }, cache: 'no-store' });
      reachable = true; keyAccepted = r.status === 200;
      if (!keyAccepted) problems.push(`Supabase rejected the anon key (HTTP ${r.status}). Copy it again from Supabase → Project Settings → API.`);
    } catch { reachable = false; problems.push('The server could not reach Supabase at NEXT_PUBLIC_SUPABASE_URL.'); }
  }
  return NextResponse.json({ ok: problems.length === 0, problems, urlHost: host, anonKey: a, serviceKeyPresent: !!svc, serviceKeyRole: s.role ?? null, reachable, keyAccepted, note: 'After changing Vercel environment variables you must Redeploy.' }, { headers: { 'cache-control': 'no-store' } });
}
