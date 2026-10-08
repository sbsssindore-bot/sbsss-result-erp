'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function SetPassword() {
  const router = useRouter();
  const [p1, setP1] = useState(''); const [p2, setP2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { supabaseBrowser().auth.getSession().then(({ data }) => { if (!data.session) router.replace('/login'); }); }, [router]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return setErr('Use at least 8 characters with letters and numbers.');
    if (p1 !== p2) return setErr('The two passwords do not match.');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: p1, data: { teacher_activated_at: new Date().toISOString() } });
    if (error) { setErr(error.message); setBusy(false); return; }
    router.replace('/'); router.refresh();
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="h2">Set your password</h1>
        {err && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
        <label className="lbl">New password<input className="input" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></label>
        <label className="lbl">Confirm password<input className="input" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        <button className="btn w-full" disabled={busy}>Save password</button>
      </form>
    </div>
  );
}
