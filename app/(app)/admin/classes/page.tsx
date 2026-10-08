import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import { ROMAN } from '@/lib/format';
import Flash from '@/components/Flash';
import { createClassSection, setClassSectionStatus } from './actions';

export default async function Classes({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  if (!session) return <p>No session.</p>;
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id,status').eq('session_id', session.id).order('class_id').order('label').range(a, b));
  const enr = await fetchAll((a, b) => sb.from('student_class_enrollments').select('class_section_id').eq('session_id', session.id).eq('status', 'ACTIVE').range(a, b));
  const count = new Map<string, number>(); enr.forEach((e: any) => count.set(e.class_section_id, (count.get(e.class_section_id) || 0) + 1));
  const { data: streams } = await sb.from('streams').select('name').order('name');
  const { data: secs } = await sb.from('sections').select('name').order('name');
  const total = sections.filter((s: any) => s.status === 'ACTIVE').reduce((a: number, s: any) => a + (count.get(s.id) || 0), 0);
  return (
    <>
      <h1 className="h2">Classes &amp; sections · {session.label}</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <form action={createClassSection} className="card flex flex-wrap items-end gap-3"><h2 className="h3 w-full !mb-0">Add a class section</h2>
        <label className="lbl !mb-0">Class<select className="input" name="class_id" required>{ROMAN.slice(1).map((r, i) => <option key={r} value={i + 1}>Class {r}</option>)}</select></label>
        <label className="lbl !mb-0">Section<input className="input" name="section" list="secs" maxLength={3} placeholder="A" /></label><datalist id="secs">{(secs || []).map((s: any) => <option key={s.name} value={s.name} />)}</datalist>
        <label className="lbl !mb-0">Stream (XI–XII)<select className="input" name="stream" defaultValue=""><option value="">None</option>{(streams || []).map((s: any) => <option key={s.name}>{s.name}</option>)}</select></label>
        <button className="btn">Add</button></form>
      <div className="card"><h2 className="h3">All class sections — {total} active students</h2>
        <div className="tw"><table className="t"><thead><tr><th>Class section</th><th>Students</th><th>Status</th><th></th></tr></thead><tbody>
          {sections.map((s: any) => <tr key={s.id}><td>{s.label}</td><td>{count.get(s.id) || 0}</td><td>{s.status === 'ACTIVE' ? <span className="chip chip-ok">Active</span> : <span className="chip">Inactive</span>}</td>
            <td><form action={setClassSectionStatus}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="to" value={s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'} /><button className="btn btn-sm btn-ghost">{s.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></form></td></tr>)}
          {sections.length === 0 && <tr><td colSpan={4} className="muted">No class sections yet. They are created automatically when you import students.</td></tr>}</tbody></table></div></div>
    </>
  );
}
