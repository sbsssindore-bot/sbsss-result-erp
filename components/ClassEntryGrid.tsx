'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveClassEntry } from '@/app/(app)/class-entry/actions';

type Row = { enrId: string; roll: number | null; name: string; working: string; present: string; co: Record<string, string>; remarks: string; status: string };
export default function ClassEntryGrid(p: {
  examId: string; csId: string; rows: Row[]; areas: { id: string; label: string }[]; gradeValues: string[];
  statuses: string[]; manualStatus: boolean; canEdit: boolean; isAdmin: boolean; batchStatus: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(p.rows);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const upd = (i: number, patch: Partial<Row>) => { setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x))); setDirty(true); setMsg(null); };
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  function setAllWorking(v: string) { setRows((r) => r.map((x) => ({ ...x, working: v }))); setDirty(true); }
  function send(submit: boolean) {
    for (const r of rows) {
      const w = num(r.working), pr = num(r.present);
      if ((w != null && (isNaN(w) || w < 0 || w > 366)) || (pr != null && (isNaN(pr) || pr < 0 || pr > 366))) return setMsg({ t: 'err', s: `Attendance for ${r.name} must be between 0 and 366.` });
      if (w != null && pr != null && pr > w) return setMsg({ t: 'err', s: `${r.name}: present days cannot exceed working days.` });
    }
    start(async () => {
      const res = await saveClassEntry({ examId: p.examId, csId: p.csId, submit, rows: rows.map((r) => ({ e: r.enrId, working: num(r.working), present: num(r.present), co: r.co, remarks: r.remarks, status: p.isAdmin && p.manualStatus ? (r.status || null) : null })) });
      if (res.ok) { setDirty(false); setMsg({ t: 'ok', s: res.message || 'Saved.' }); router.refresh(); } else setMsg({ t: 'err', s: res.error || 'Could not save.' });
    });
  }
  return (
    <>
      {msg && <div role="status" className={`mb-3 rounded-md border px-4 py-2.5 text-sm ${msg.t === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{msg.s}</div>}
      {p.canEdit && <label className="lbl max-w-xs">Working days for everyone (optional shortcut)<input className="input" inputMode="decimal" onChange={(e) => setAllWorking(e.target.value)} /></label>}
      <div className="tw"><table className="t"><thead><tr><th className="sticky left-0 z-10 bg-slate-100">Student</th><th>Working days</th><th>Present days</th>
        {p.areas.map((a) => <th key={a.id} className="text-center">{a.label}</th>)}{p.manualStatus && <th>Result status</th>}<th>Class teacher remarks</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.enrId}>
            <td className="sticky left-0 z-[1] min-w-[150px] bg-white shadow-[1px_0_0_#D8DEE8]"><b>{r.roll ?? '—'}</b> {r.name}</td>
            <td>{p.canEdit ? <input className="input !w-24" inputMode="decimal" value={r.working} onChange={(e) => upd(i, { working: e.target.value })} aria-label={`${r.name} working days`} /> : r.working || '—'}</td>
            <td>{p.canEdit ? <input className="input !w-24" inputMode="decimal" value={r.present} onChange={(e) => upd(i, { present: e.target.value })} aria-label={`${r.name} present days`} /> : r.present || '—'}</td>
            {p.areas.map((a) => <td key={a.id} className="text-center">{p.canEdit ?
              <select className="input !w-20" value={r.co[a.id] || ''} onChange={(e) => upd(i, { co: { ...r.co, [a.id]: e.target.value } })} aria-label={`${r.name} ${a.label}`}><option value="">—</option>{p.gradeValues.map((g) => <option key={g}>{g}</option>)}</select> : (r.co[a.id] || '—')}</td>)}
            {p.manualStatus && <td>{p.isAdmin && p.canEdit ? <select className="input !w-40" value={r.status} onChange={(e) => upd(i, { status: e.target.value })}><option value="">—</option>{p.statuses.map((s) => <option key={s}>{s}</option>)}</select> : (r.status || '—')}</td>}
            <td>{p.canEdit ? <input className="input !min-w-[220px]" maxLength={500} value={r.remarks} onChange={(e) => upd(i, { remarks: e.target.value })} aria-label={`${r.name} remarks`} /> : r.remarks}</td>
          </tr>))}
          {rows.length === 0 && <tr><td className="muted" colSpan={9}>No students in this class section.</td></tr>}</tbody></table></div>
      {p.canEdit && <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:left-60">
        <span className="muted flex-1">{pending ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button className="btn btn-sec" disabled={pending} onClick={() => send(false)}>Save</button>
        {(p.batchStatus === 'DRAFT' || p.batchStatus === 'NONE') && <button className="btn btn-maroon" disabled={pending} onClick={() => send(true)}>{p.isAdmin ? 'Save & mark submitted' : 'Submit'}</button>}
      </div>}
    </>
  );
}
