'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from '@/app/actions/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (new URLSearchParams(location.search).get('error') === 'inactive') setErr('This account is inactive. Contact the administrator.'); }, []);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await signIn(email, password);
    if (!r.ok) { setErr(r.error || 'Login ID or password is incorrect.'); setBusy(false); return; }
    router.replace('/'); router.refresh();
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-ink from-45% to-paper to-45% p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-xl">
        <img src="/sbsss-logo.png" alt="SBSSS logo" className="mx-auto mb-3 h-24 w-24 object-contain" />
        <h1 className="text-center text-sm font-bold tracking-wide text-ink">SHRI BHARTIYA SANSKRITI SHIKSHA SANSTHAN</h1>
        <p className="mb-5 text-center text-xs text-slate-500">Result Management System</p>
        {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
        <label className="lbl">Email or Login ID<input className="input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="lbl">Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="mt-3 text-center text-sm"><Link className="text-maroon underline" href="/forgot-password">Forgot password?</Link></p>
        <p className="mt-2 text-center text-sm">New teacher? <Link className="text-maroon underline" href="/teacher-activate">Activate your account</Link></p>
      </form>
    </div>
  );
}
