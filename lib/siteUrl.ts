/**
 * The public origin to put into emailed links (invitation / password reset).
 * Order: NEXT_PUBLIC_SITE_URL → request origin → forwarded host → Vercel production URL → built-in production default.
 * A localhost value is accepted ONLY in development; in production it is ignored so a stale setting can never send
 * teachers to http://localhost:3000.
 */
export const PRODUCTION_DEFAULT = 'https://sbsss-result-erp.vercel.app';
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(u);
const tidy = (v?: string | null) => {
  let u = String(v ?? '').replace(/[\s​-‍﻿]/g, '').replace(/^["'`]+|["'`]+$/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).origin; } catch { return ''; }
};

export function siteUrlFrom(env: Record<string, string | undefined>, get: (h: string) => string | null | undefined): string {
  const prod = env.NODE_ENV === 'production';
  const ok = (u: string) => !!u && (!prod || !isLocal(u));
  const fwdHost = (get('x-forwarded-host') || '').split(',')[0].trim();
  const fwdProto = (get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const candidates = [
    tidy(env.NEXT_PUBLIC_SITE_URL),
    tidy(get('origin')),
    fwdHost ? tidy(`${fwdProto}://${fwdHost}`) : '',
    env.VERCEL_PROJECT_PRODUCTION_URL ? tidy(env.VERCEL_PROJECT_PRODUCTION_URL) : '',
  ];
  for (const c of candidates) if (ok(c)) return c;
  return prod ? PRODUCTION_DEFAULT : 'http://localhost:3000';
}

/** Where an emailed link should land: the callback that accepts the Supabase session, then the set-password page. */
export const callbackUrl = (site: string, next = '/set-password') => `${site}/auth/callback?next=${encodeURIComponent(next)}`;
