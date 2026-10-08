import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { sbServiceKey, sbUrl } from '@/lib/env';

/**
 * SERVICE-ROLE client. Bypasses RLS. Server-only: never import this from a client component,
 * and never prefix the key with NEXT_PUBLIC_. Use only after verifying the caller is an admin.
 */
export function supabaseAdmin() {
  const key = sbServiceKey();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  return createClient(sbUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
