'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent('/set-password')}`,
      });
      if (error) {
        setErr('We could not send the reset link right now. Please check the email address and try again, or contact the ERP administrator.');
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setErr('We could not send the reset link right now. Please try again or contact the ERP administrator.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="h2">Reset password</h1>
        {done ? (
          <div role="status" className="text-sm">
            <p>If this email is registered with the school, a password-reset link has been sent. Please check your inbox and spam folder.</p>
            <p className="mt-2">Open the link and create a new password. Your existing teacher account and Login ID will remain the same—do not activate a second account.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">Enter the same email address registered with the school/ERP. We will send a secure link to set a new password.</p>
            {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
            <label className="lbl">Registered email<input className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="btn w-full" disabled={busy}>{busy ? 'Sending reset link…' : 'Send reset link'}</button>
          </>
        )}
        <p className="mt-3 text-center text-sm"><Link className="text-maroon underline" href="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
