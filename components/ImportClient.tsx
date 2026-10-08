'use client';
import { useRef, useState, useTransition } from 'react';
import { readImportFile, previewImport, commitImport, type Preview, type ReadResult } from '@/app/(app)/admin/import/actions';

type Kind = 'STUDENTS' | 'TEACHERS' | 'ASSIGNMENTS';
const NOUN: Record<Kind, string> = { STUDENTS: 'student', TEACHERS: 'teacher', ASSIGNMENTS: 'assignment' };
const MODES: Record<Kind, { v: string; t: string }[]> = {
  STUDENTS: [{ v: 'CREATE', t: 'Skip students that already exist, add new ones only' }, { v: 'UPDATE', t: 'Update students that already exist and add new ones' }],
  TEACHERS: [{ v: 'CREATE', t: 'Skip teachers that already exist, add new ones only' }, { v: 'UPDATE', t: 'Update teachers that already exist and add new ones' }],
  ASSIGNMENTS: [{ v: 'SKIP', t: 'If another teacher already has it: keep the existing teacher (skip)' }, { v: 'ADD', t: 'If another teacher already has it: add as an additional subject teacher' }, { v: 'REPLACE', t: 'If another teacher already has it: replace the existing teacher' }],
};

export default function ImportClient({ kind }: { kind: Kind }) {
  const file = useRef<File | null>(null);
  const [rd, setRd] = useState<ReadResult | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [pv, setPv] = useState<Preview | null>(null);
  const [mode, setMode] = useState(MODES[kind][0].v);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [busy, start] = useTransition();

  function reset() { file.current = null; setRd(null); setPv(null); setResult(null); setError(''); setMap({}); }
  function onRead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setResult(null); setPv(null); setRd(null);
    const f = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!f) return; file.current = f;
    const fd = new FormData(); fd.set('kind', kind); fd.set('file', f);
    start(async () => { const r = await readImportFile(fd); if (!r.ok) setError(r.error || 'Could not read the file.'); else { setRd(r); setMap(r.mapping); } });
  }
  function onPreview() {
    if (!file.current) return; setError(''); setPv(null);
    const fd = new FormData(); fd.set('kind', kind); fd.set('file', file.current); fd.set('mapping', JSON.stringify(map));
    start(async () => { const r = await previewImport(fd); if (!r.ok) setError(r.error || 'Could not validate the file.'); else setPv(r); });
  }
  function onCommit() {
    if (!pv?.batchId) return; setError('');
    start(async () => { const r = await commitImport(pv.batchId!, kind, mode); if (r.ok) { setResult(r.result || {}); setPv(null); setRd(null); file.current = null; } else setError(r.error || 'Import failed. Nothing was changed.'); });
  }
  const missing = rd ? rd.fields.filter((f) => f.required && !map[f.key]).map((f) => f.label) : [];
  const noun = NOUN[kind];

  return (
    <div>
      <form onSubmit={onRead} className="card">
        <h2 className="h3">1. Upload the file</h2>
        <label className="lbl max-w-md">Excel (.xlsx) or CSV file<input className="input" type="file" name="file" accept=".xlsx,.xls,.csv" required /></label>
        <div className="flex gap-2"><button className="btn" disabled={busy}>{busy && !rd && !pv ? 'Reading file…' : 'Read file'}</button>{(rd || pv || result) && <button type="button" className="btn btn-ghost" onClick={reset}>Start over</button>}</div>
        <p className="muted mt-2">Nothing is saved until you confirm in the last step.</p>
      </form>

      {error && <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {result && (
        <div className="card border-emerald-300 bg-emerald-50"><h2 className="h3 text-emerald-800">Import finished</h2>
          <div className="flex flex-wrap gap-5 text-sm">{Object.entries(result).map(([k, v]) => <div key={k}><b className="text-xl">{v}</b> <span className="muted">{k.replace(/_/g, ' ')}</span></div>)}</div></div>)}

      {rd && !pv && (
        <div className="card">
          <h2 className="h3">2. Match the columns <span className="muted font-normal">({rd.rowCount} rows found)</span></h2>
          <p className="muted mb-3">We matched what we could. Check each line and change it if needed. Fields marked * are required.</p>
          <div className="tw mb-3"><table className="t"><thead><tr><th>What the system needs</th><th>Column in your file</th><th>Example from your file</th></tr></thead><tbody>
            {rd.fields.map((f) => {
              const col = map[f.key]; const idx = col ? rd.headers.indexOf(col) : -1;
              return (<tr key={f.key}><td className="wrap"><b>{f.label}</b>{f.required && <span className="text-red-700"> *</span>}{f.hint && <div className="muted">{f.hint}</div>}</td>
                <td><select className={`input !min-h-[40px] ${f.required && !col ? '!border-red-500' : ''}`} value={col || ''} aria-label={`Column for ${f.label}`}
                  onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value) n[f.key] = e.target.value; else delete n[f.key]; return n; })}>
                  <option value="">— not in my file —</option>{rd.headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></td>
                <td className="text-slate-600">{idx >= 0 ? rd.sample.map((r) => r[idx]).filter(Boolean).slice(0, 3).join(' · ') : ''}</td></tr>);
            })}</tbody></table></div>
          {missing.length > 0 && <p className="mb-3 text-sm text-red-700">Still needed: {missing.join(', ')}</p>}
          <button className="btn" disabled={busy || missing.length > 0} onClick={onPreview}>{busy ? 'Checking…' : 'Check and preview'}</button>
        </div>)}

      {pv && pv.ok && (
        <>
          <div className="card"><h2 className="h3">3. Preview and validation — {pv.fileName}</h2>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="stat"><div className="v">{pv.total}</div><div className="l">Rows</div></div>
              <div className="stat"><div className="v text-emerald-700">{pv.valid}</div><div className="l">Valid</div></div>
              <div className="stat"><div className="v text-red-700">{pv.invalid}</div><div className="l">Errors (skipped)</div></div>
              <div className="stat"><div className="v">{pv.existing}</div><div className="l">Already exist</div></div>
              <div className="stat"><div className="v text-amber-700">{pv.conflicts || pv.warnings}</div><div className="l">{kind === 'ASSIGNMENTS' ? 'Teacher conflicts' : 'Warnings'}</div></div></div>
            {pv.normalized.length > 0 && <><h3 className="mb-1 mt-3 text-sm font-semibold">Values we standardised (please check)</h3>
              <div className="tw mb-2 max-h-48"><table className="t"><thead><tr><th>Column</th><th>In your file</th><th>Becomes</th></tr></thead><tbody>{pv.normalized.map((n, i) => <tr key={i}><td>{n.column}</td><td>{n.from}</td><td>{n.to}</td></tr>)}</tbody></table></div></>}
            {pv.newSections.length > 0 && <p className="mb-2 text-sm"><b>New class sections that will be created:</b> {pv.newSections.join(', ')}</p>}
            {pv.errors.length > 0 && <><h3 className="mb-1 mt-3 text-sm font-semibold text-red-800">Error report — these rows will NOT be imported</h3>
              <div className="tw mb-2 max-h-64"><table className="t"><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>{pv.errors.map((e, i) => <tr key={i}><td>{e.row}</td><td className="wrap">{e.message}</td></tr>)}</tbody></table></div></>}
            {pv.warningList.length > 0 && <><h3 className="mb-1 mt-3 text-sm font-semibold text-amber-800">Duplicate / conflict notes</h3>
              <div className="tw mb-2 max-h-48"><table className="t"><thead><tr><th>Row</th><th>Note</th></tr></thead><tbody>{pv.warningList.map((e, i) => <tr key={i}><td>{e.row}</td><td className="wrap">{e.message}</td></tr>)}</tbody></table></div></>}
            <button className="btn btn-ghost btn-sm mt-2" onClick={() => setPv(null)}>← Change column matching</button>
          </div>
          <div className="card"><h2 className="h3">4. Confirm</h2>
            <label className="lbl max-w-xl">How to handle existing data
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES[kind].map((m) => <option key={m.v} value={m.v}>{m.t}</option>)}</select></label>
            <p className="muted mb-3">{pv.valid} valid row(s) will be saved in one safe step. If anything fails, nothing is changed.</p>
            <button className="btn btn-maroon" disabled={busy || pv.valid === 0} onClick={onCommit}>{busy ? 'Importing…' : `Confirm import of ${pv.valid} ${noun} row(s)`}</button></div>
        </>)}
    </div>
  );
}
