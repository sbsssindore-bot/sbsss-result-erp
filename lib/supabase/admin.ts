import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * SERVICE-ROLE client. Bypasses RLS. Server-only: never import this from a client component,
 * and never prefix the key with NEXT_PUBLIC_. Use only after verifying the caller is an admin.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
