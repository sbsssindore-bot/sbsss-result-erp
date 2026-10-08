'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/** Handles invitation and password-reset links (both the ?code= and #access_token= styles). */
export default function Callback() {
  const router = useRouter();
  const [err, setErr] = useState('');
  useEffect(() => {
    const sb = supabaseBrowser();
    const next = new URLSearchParams(location.search).get('next') || '/';
    const code = new URLSearchParams(location.search).get('code');
    (async () => {
      if (code) { const { error } = await sb.auth.exchangeCodeForSession(code); if (error) { setErr('This link has expired. Ask for a new one.'); return; } router.replace(next); return; }
      const { data } = await sb.auth.getSession();
      if (data.session) { router.replace(next); return; }
      const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (s) router.replace(next); });
      setTimeout(() => { sub.subscription.unsubscribe(); setErr('This link is invalid or has expired. Ask for a new one.'); }, 6000);
    })();
  }, [router]);
  return <div className="flex min-h-screen items-center justify-center p-4 text-sm">{err ? <span className="text-red-700">{err}</span> : 'Signing you in…'}</div>;
}
