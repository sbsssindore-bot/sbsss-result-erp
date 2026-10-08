/**
 * Supabase settings, cleaned. Vercel values are often pasted with a trailing newline/space, wrapping quotes,
 * a trailing slash, or the "/rest/v1" suffix — any of which makes every request fail ("fetch failed"
 * or "Invalid header value") even though the value "looks" right. Used by EVERY Supabase client.
 * Pass the literal process.env.NEXT_PUBLIC_* expression in (Next.js only inlines literal accesses in browser code).
 */
const INVISIBLE = /[\s ​-‍⁠﻿]/g;
export const cleanValue = (v: string | undefined | null): string =>
  String(v ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(INVISIBLE, '');

export function cleanSupabaseUrl(v: string | undefined | null): string {
  let u = cleanValue(v);
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '').replace(/\/(rest|auth|storage|realtime)\/v1.*$/i, '').replace(/\/+$/, '');
  return u;
}
export const cleanKey = (v: string | undefined | null): string => cleanValue(v);

export const sbUrl = () => cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const sbAnonKey = () => cleanKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const sbServiceKey = () => cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
