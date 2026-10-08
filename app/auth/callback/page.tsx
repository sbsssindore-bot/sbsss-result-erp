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
    const q = new URLSearchParams(location.search);
    const rawNext = q.get('next') || '/';
    const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'; // never redirect off-site
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const code = q.get('code');
    if (hash.get('error') || q.get('error')) { setErr('This link is invalid or has expired. Ask the administrator to send a new invitation.'); return; }
    let sub: { unsubscribe: () => void } | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      if (code) { const { error } = await sb.auth.exchangeCodeForSession(code); if (error) { setErr('This link has expired. Ask for a new one.'); return; } router.replace(next); return; }
      const { data } = await sb.auth.getSession(); // also picks up #access_token=… from the invitation link
      if (data.session) { router.replace(next); return; }
      sub = sb.auth.onAuthStateChange((_e, s) => { if (s) router.replace(next); }).data.subscription;
      timer = setTimeout(() => { sub?.unsubscribe(); setErr('This link is invalid or has expired. Ask the administrator to send a new invitation.'); }, 8000);
    })();
    return () => { sub?.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [router]);
  return <div className="flex min-h-screen items-center justify-center p-4 text-sm">{err ? <span className="text-red-700">{err}</span> : 'Signing you in…'}</div>;
}
