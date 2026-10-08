'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { activateTeacherAccount } from '@/app/actions/activate';

export default function TeacherActivate() {
  const router = useRouter();
  const [empId, setEmpId] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; loginId?: string; already?: boolean; redirect?: boolean } | null>(null);

  useEffect(() => { if (!done?.redirect) return; const t = setTimeout(() => router.replace('/login?activated=1'), 3000); return () => clearTimeout(t); }, [done, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    const r = await activateTeacherAccount(empId.trim(), email.trim(), pw);
    setBusy(false);
    if (r.ok) { setDone({ message: r.message, loginId: r.loginId, redirect: true }); return; }
    if (r.code === 'ALREADY') { setDone({ message: r.message, loginId: r.loginId, already: true }); return; }
    setErr(r.message);
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-ink from-45% to-paper to-45% p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-xl">
        <img src="/sbsss-logo.png" alt="SBSSS logo" className="mx-auto mb-3 h-20 w-20 object-contain" />
        <h1 className="text-center text-sm font-bold tracking-wide text-ink">SHRI BHARTIYA SANSKRITI SHIKSHA SANSTHAN</h1>
        <p className="mb-4 text-center text-xs text-slate-500">Teacher Account Activation</p>
        {done ? (
          <div>
            <div role="status" className={`mb-3 rounded-md border px-3 py-2 text-sm ${done.already ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-900'}`}>
              {done.already ? '' : '✅ '}{done.message}
            </div>
            {done.loginId && <p className="mb-3 text-sm">Your Login ID: <b>{done.loginId}</b></p>}
            {done.redirect && <p className="mb-2 text-xs text-slate-500">Taking you to the login page…</p>}
            <Link className="btn w-full text-center" href="/login?activated=1">Go to Teacher Login</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="mb-3 text-xs text-slate-600">Enter your Teacher ID and the email address registered with the school, then choose a password. No email will be sent.</p>
            {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
            <label className="lbl">Employee ID / Teacher ID<input className="input" required autoCapitalize="characters" autoComplete="username" spellCheck={false} value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="e.g. T010" /></label>
            <label className="lbl">Registered email address<input className="input" type="email" required autoCapitalize="none" autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="lbl">Create password<input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <label className="lbl">Confirm password<input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
            <p className="mb-3 text-xs text-slate-500">At least 8 characters, with letters and numbers.</p>
            <button className="btn w-full" disabled={busy}>{busy ? 'Activating…' : 'Activate my account'}</button>
          </form>
        )}
        <p className="mt-3 text-center text-sm"><Link className="text-maroon underline" href="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
