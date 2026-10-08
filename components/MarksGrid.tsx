'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { C, gradeOf, type Band } from '@/lib/calc';
import { fmtNum, f2 } from '@/lib/format';
import { saveMarks } from '@/app/(app)/marks/actions';

type Comp = { id: string; label: string; max: number };
type Row = { enrId: string; roll: number | null; name: string; values: Record<string, string> };

function parse(raw: string, max: number): { ok: boolean; v: number | null; ab: boolean; err?: string } {
  const s = raw.trim();
  if (s === '') return { ok: true, v: null, ab: false };
  if (/^ab$/i.test(s)) return { ok: true, v: null, ab: true };
  if (!/^-?\d*\.?\d+$/.test(s)) return { ok: false, v: null, ab: false, err: 'Enter a number or AB' };
  const n = Number(s);
  if (n < 0) return { ok: false, v: null, ab: false, err: 'Marks cannot be negative' };
  if (n > max) return { ok: false, v: null, ab: false, err: `Maximum is ${max}` };
  if (Math.round(n * 100) / 100 !== n) return { ok: false, v: null, ab: false, err: 'Use at most 2 decimals' };
  return { ok: true, v: n, ab: false };
}

export default function MarksGrid(p: {
  examId: string; csId: string; subId: string; comps: Comp[]; rows: Row[]; bands: Band[];
  canEdit: boolean; isAdmin: boolean; status: string;
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(p.rows.map((r) => [r.enrId, { ...r.values }])));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [pending, start] = useTransition();
  const totalMax = p.comps.reduce((a, c) => a + c.max, 0);

  const calc = useMemo(() => {
    const out: Record<string, { total: string; pct: string; grade: string; bad: boolean; missing: number }> = {};
    for (const r of p.rows) {
      let t = 0, m = 0, miss = 0, bad = false;
      for (const c of p.comps) {
        const x = parse(vals[r.enrId]?.[c.id] ?? '', c.max);
        m += C(c.max);
        if (!x.ok) { bad = true; continue; }
        if (x.ab) continue;
        if (x.v == null) miss++; else t += C(x.v);
      }
      out[r.enrId] = { total: bad ? '—' : fmtNum(t / 100), pct: bad || !m ? '—' : f2((t * 100) / m), grade: bad || miss ? '—' : gradeOf(t, m, p.bands), bad, missing: miss };
    }
    return out;
  }, [vals, p.rows, p.comps, p.bands]);

  const invalid = p.rows.reduce((a, r) => a + p.comps.filter((c) => !parse(vals[r.enrId]?.[c.id] ?? '', c.max).ok).length, 0);
  const missingCount = p.rows.reduce((a, r) => a + (calc[r.enrId]?.missing || 0), 0);
  const filled = p.rows.length * p.comps.length - missingCount;

  function set(e: string, c: string, v: string) { setVals((s) => ({ ...s, [e]: { ...s[e], [c]: v } })); setDirty(true); setMsg(null); }
  function keynav(ev: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) {
    const move = (r: number, c: number) => { const el = document.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`); if (el) { ev.preventDefault(); el.focus(); el.select(); } };
    if (ev.key === 'Enter' || ev.key === 'ArrowDown') move(ri + 1, ci);
    else if (ev.key === 'ArrowUp') move(ri - 1, ci);
  }
  function send(submit: boolean) {
    if (invalid) { setMsg({ t: 'err', s: `${invalid} value(s) are not valid. Fix the highlighted cells.` }); return; }
    if (submit && missingCount > 0 && !confirm(`${missingCount} mark(s) are still empty. Submit anyway?`)) return;
    const rows = p.rows.flatMap((r) => p.comps.map((c) => {
      const x = parse(vals[r.enrId]?.[c.id] ?? '', c.max);
      return { e: r.enrId, c: c.id, v: x.v, ab: x.ab };
    }));
    start(async () => {
      const res = await saveMarks({ examId: p.examId, csId: p.csId, subId: p.subId, submit, rows });
      if (res.ok) { setDirty(false); setMsg({ t: 'ok', s: res.message || 'Saved.' }); router.refresh(); }
      else setMsg({ t: 'err', s: res.error || 'Could not save.' });
    });
  }

  return (
    <>
      {msg && <div role="status" className={`mb-3 rounded-md border px-4 py-2.5 text-sm ${msg.t === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{msg.s}</div>}
      <p className="muted mb-2">{filled} of {p.rows.length * p.comps.length} entered{invalid ? ` · ${invalid} invalid` : ''}{dirty ? ' · unsaved changes' : ''}. {p.canEdit && <>Type marks (decimals allowed) or <b>AB</b> for absent. Enter or ↓ moves to the next student.</>}</p>
      <div className="tw">
        <table className="t">
          <thead><tr>
            <th className="sticky left-0 z-10 bg-slate-100">Student</th>
            {p.comps.map((c) => <th key={c.id} className="text-center">{c.label}<br /><span className="font-normal text-slate-500">({fmtNum(c.max)})</span></th>)}
            <th className="text-center">Total<br /><span className="font-normal text-slate-500">({fmtNum(totalMax)})</span></th><th className="text-center">%</th><th className="text-center">Grade</th>
          </tr></thead>
          <tbody>
            {p.rows.map((r, ri) => (
              <tr key={r.enrId}>
                <td className="sticky left-0 z-[1] min-w-[150px] bg-white shadow-[1px_0_0_#D8DEE8]"><b>{r.roll ?? '—'}</b> {r.name}</td>
                {p.comps.map((c, ci) => {
                  const raw = vals[r.enrId]?.[c.id] ?? ''; const x = parse(raw, c.max);
                  return (
                    <td key={c.id} className="text-center">
                      {p.canEdit ? (
                        <input className={`input !min-h-[44px] !w-[84px] text-center ${x.ok ? '' : '!border-red-600 bg-red-50'}`} inputMode="decimal" autoComplete="off"
                          aria-label={`${r.name} ${c.label}`} title={x.ok ? '' : x.err} data-cell={`${ri}-${ci}`} value={raw}
                          onChange={(ev) => set(r.enrId, c.id, ev.target.value)} onKeyDown={(ev) => keynav(ev, ri, ci)} />
                      ) : (raw === '' ? '—' : raw.toUpperCase())}
                    </td>
                  );
                })}
                <td className="text-center font-semibold">{calc[r.enrId].total}</td><td className="text-center">{calc[r.enrId].pct}</td><td className="text-center font-bold">{calc[r.enrId].grade}</td>
              </tr>
            ))}
            {p.rows.length === 0 && <tr><td colSpan={p.comps.length + 4} className="muted">No students in this class section for this subject.</td></tr>}
          </tbody>
        </table>
      </div>
      {p.canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:left-60">
          <span className="muted flex-1">{pending ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button className="btn btn-sec" disabled={pending} onClick={() => send(false)}>Save draft</button>
          {(p.status === 'DRAFT' || p.status === 'NONE') && <button className="btn btn-maroon" disabled={pending} onClick={() => send(true)}>{p.isAdmin ? 'Save & mark submitted' : 'Submit marks'}</button>}
        </div>
      )}
    </>
  );
}
