import { createBrowserClient } from '@supabase/ssr';
import { cleanKey, cleanSupabaseUrl } from '@/lib/env';
export function supabaseBrowser() {
  return createBrowserClient(cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), cleanKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}
