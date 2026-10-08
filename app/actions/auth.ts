'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { loginErrorMessage } from '@/lib/loginError';

export async function signOut() {
  await supabaseServer().auth.signOut();
  redirect('/login');
}

const BAD = 'Login ID or password is incorrect.';
/** Sign in with an email OR a teacher's Login ID / Teacher ID. The lookup happens on the server, so emails are never exposed. */
export async function signIn(identifier: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const id = String(identifier || '').replace(/[\u00A0\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  if (!id || !password) return { ok: false, error: 'Enter your login ID and password.' };
  let email = id.includes('@') ? id.toLowerCase() : id;
  if (!id.includes('@')) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin');
      const { resolveLoginEmail } = await import('@/lib/loginId');
      const found = await resolveLoginEmail(supabaseAdmin(), id);
      if (!found) return { ok: false, error: BAD };
      email = found;
    } catch { return { ok: false, error: 'Sign-in with a Login ID is not available right now. Use your email address.' }; }
  }
  try {
    const { error } = await supabaseServer().auth.signInWithPassword({ email, password });
    return error ? { ok: false, error: loginErrorMessage(error) } : { ok: true };
  } catch { return { ok: false, error: loginErrorMessage({ message: 'fetch failed' }) }; }
}
