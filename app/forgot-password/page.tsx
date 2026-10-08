'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/auth/callback?next=/set-password` });
    setDone(true); setBusy(false);
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="h2">Reset password</h1>
        {done ? <p className="text-sm">If this email is registered, a reset link has been sent. Check your inbox.</p> : <>
          <label className="lbl">Email<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn w-full" disabled={busy}>Send reset link</button></>}
        <p className="mt-3 text-center text-sm"><Link className="text-maroon underline" href="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
