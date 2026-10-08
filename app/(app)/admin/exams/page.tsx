import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import Flash from '@/components/Flash';
import { createExam } from './actions';

export default async function Exams({ searchParams }: { searchParams: { msg?: string; err?: string; type?: string } }) {
  const { sb } = await requireAdmin();
  const { session, exams } = await sessionAndExams(sb);
  if (!session) return <p>No session.</p>;
  const terms = exams.filter((e: any) => e.type === 'TERM');
  const annual = searchParams.type === 'ANNUAL';
  return (
    <>
      <h1 className="h2">Examinations · {session.label}</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <div className="card"><div className="tw"><table className="t"><thead><tr><th>Name</th><th>Type</th><th>Prints as (Academic Term)</th><th>Status</th><th></th></tr></thead><tbody>
        {exams.map((e: any) => <tr key={e.id}><td>{e.name}</td><td>{e.type === 'ANNUAL' ? 'Annual / Final' : 'Term'}</td><td>{e.term_label}</td><td><span className="chip">{e.status}</span></td><td><Link className="btn btn-sm btn-sec" href={`/admin/exams/${e.id}`}>Configure</Link></td></tr>)}
      </tbody></table></div></div>
      <form action={createExam} className="card"><h2 className="h3">Add examination</h2>
        <p className="muted mb-3">Students, classes, sections, subjects and teacher assignments are reused. Only the assessment setup and marks are new. Term I stays stored separately.</p>
        <div className="mb-3 flex gap-2"><Link className={`rounded-md border px-3 py-1.5 text-sm ${!annual ? 'border-ink bg-ink text-white' : 'border-line'}`} href="/admin/exams">Term</Link><Link className={`rounded-md border px-3 py-1.5 text-sm ${annual ? 'border-ink bg-ink text-white' : 'border-line'}`} href="/admin/exams?type=ANNUAL">Annual / Final</Link></div>
        <input type="hidden" name="type" value={annual ? 'ANNUAL' : 'TERM'} />
        <div className="grid gap-x-4 md:grid-cols-2"><label className="lbl">Name *<input className="input" name="name" placeholder={annual ? 'Annual Examination' : 'Term II'} required /></label>
          <label className="lbl">Prints as “Academic Term”<input className="input" name="label" placeholder={annual ? 'Annual' : 'Term - II'} /></label></div>
        {!annual ? <>
          <label className="lbl max-w-sm">Copy the structure of<select className="input" name="from" defaultValue={terms[terms.length - 1]?.id}>{terms.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="rename" defaultChecked className="h-5 w-5" /> Rename PT-I → PT-II, MT → MT-II, First Term → Second Term</label></> : <>
          <label className="lbl max-w-sm">Calculation method<select className="input" name="method"><option value="WEIGHTED">Weighted average of examination percentages</option><option value="SUM">Sum of marks from the selected examinations</option></select></label>
          <div className="mb-3"><div className="muted mb-1">Combine these examinations (weight)</div>{terms.map((t: any) => <div key={t.id} className="mb-2 flex items-center gap-2"><label className="pick !mb-0"><input type="checkbox" name="src" value={t.id} defaultChecked /> {t.name}</label><input className="input !w-24" type="number" min={0} name={`w_${t.id}`} defaultValue={50} aria-label={`Weight for ${t.name}`} /></div>)}</div></>}
        <button className="btn">Create examination</button></form>
    </>
  );
}
