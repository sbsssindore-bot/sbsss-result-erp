import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sbAnonKey, sbUrl } from '@/lib/env';

/** Supabase client that acts AS THE SIGNED-IN USER. Row Level Security applies. */
export function supabaseServer() {
  const store = cookies();
  return createServerClient(sbUrl(), sbAnonKey(), {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(list) {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* called from a Server Component */ }
      },
    },
  });
}
