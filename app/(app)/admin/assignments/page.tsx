import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { assignSubjectTeacher, assignClassTeacher, removeAssignment } from './actions';

export default async function Assignments({ searchParams }: { searchParams: { teacher?: string; msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  if (!session) return <p>No session.</p>;
  const teachers = await fetchAll((a, b) => sb.from('teachers').select('id,name,employee_id,status').order('name').range(a, b));
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const subs = await fetchAll((a, b) => sb.from('class_subjects').select('class_id,subjects(name)').eq('session_id', session.id).eq('status', 'ACTIVE').eq('kind', 'MARKS').range(a, b));
  const subjectNames = [...new Set(subs.map((s: any) => s.subjects?.name).filter(Boolean))].sort() as string[];
  const all = await fetchAll((a, b) => sb.from('teacher_assignments').select('id,teacher_id,role,class_section_id,class_sections(label,class_id),class_subjects(display_label),teachers(name)').eq('session_id', session.id).range(a, b));
  const tid = teachers.find((t: any) => t.id === searchParams.teacher)?.id || teachers[0]?.id;
  const mine = (all as any[]).filter((a) => a.teacher_id === tid).sort((x, y) => x.class_sections?.class_id - y.class_sections?.class_id || String(x.class_sections?.label).localeCompare(y.class_sections?.label));
  const byCs = new Map<string, { label: string; class_id: number; ct: string[]; st: string[] }>();
  (all as any[]).forEach((a) => { const g = byCs.get(a.class_section_id) || { label: a.class_sections?.label, class_id: a.class_sections?.class_id, ct: [], st: [] }; if (a.role === 'CLASS') g.ct.push(a.teachers?.name); else g.st.push(`${a.class_subjects?.display_label}: ${a.teachers?.name}`); byCs.set(a.class_section_id, g); });
  const overview = [...byCs.values()].sort((x, y) => x.class_id - y.class_id || String(x.label).localeCompare(y.label));
  const Teacher = <label className="lbl max-w-sm">Teacher<select className="input" name="teacher" defaultValue={tid} required>{teachers.filter((t: any) => t.status === 'ACTIVE' || t.id === tid).map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.employee_id})</option>)}</select></label>;
  const Sections = <div className="mb-3"><div className="muted mb-1">Class sections (tick as many as needed)</div><div>{sections.map((s: any) => <label key={s.id} className="pick"><input type="checkbox" name="cs" value={s.id} /> {s.label}</label>)}</div></div>;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="h2 !mb-0 flex-1">Teacher assignments · {session.label}</h1><Link className="btn btn-sec" href="/admin/import/assignments">Bulk Import Assignments</Link></div>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <form method="get" className="card flex flex-wrap items-end gap-3"><label className="lbl !mb-0 min-w-[240px]">Show assignments of<select className="input" name="teacher" defaultValue={tid}>{teachers.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.employee_id})</option>)}</select></label><button className="btn btn-sec">Show</button></form>

      <form action={assignSubjectTeacher} className="card"><h2 className="h3">A. Subject teacher</h2>{Teacher}{Sections}
        <div className="mb-3"><div className="muted mb-1">Subjects (matched in every selected class where the subject exists)</div><div>{subjectNames.map((n) => <label key={n} className="pick"><input type="checkbox" name="subj" value={n} /> {n}</label>)}</div></div>
        <label className="lbl max-w-sm">If another teacher already teaches it<select className="input" name="mode" defaultValue="skip"><option value="skip">Skip (keep existing teacher)</option><option value="add">Add as additional teacher</option><option value="replace">Replace existing teacher</option></select></label>
        <button className="btn">Assign as subject teacher</button></form>

      <form action={assignClassTeacher} className="card"><h2 className="h3">B. Class teacher <span className="muted">(attendance, co-scholastic grades, remarks)</span></h2>{Teacher}{Sections}
        <label className="lbl max-w-sm">If the class already has a class teacher<select className="input" name="mode" defaultValue="skip"><option value="skip">Skip</option><option value="replace">Replace</option></select></label>
        <button className="btn btn-sec">Assign as class teacher</button></form>

      <div className="card"><h2 className="h3">Current assignments of {teachers.find((t: any) => t.id === tid)?.name} ({mine.length})</h2>
        <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Role</th><th>Subject</th><th></th></tr></thead><tbody>
          {mine.map((a) => <tr key={a.id}><td>{a.class_sections?.label}</td><td>{a.role === 'SUBJECT' ? 'Subject teacher' : <b>Class teacher</b>}</td><td>{a.class_subjects?.display_label || '—'}</td>
            <td><form action={removeAssignment}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="teacher" value={tid} /><button className="btn btn-sm btn-ghost">Remove</button></form></td></tr>)}
          {mine.length === 0 && <tr><td colSpan={4} className="muted">No assignments yet.</td></tr>}</tbody></table></div></div>

      <div className="card"><h2 className="h3">Who teaches what</h2><div className="tw"><table className="t"><thead><tr><th>Class</th><th>Class teacher</th><th>Subject teachers</th></tr></thead><tbody>
        {overview.map((g) => <tr key={g.label}><td>{g.label}</td><td>{g.ct.join(', ') || '—'}</td><td className="wrap">{g.st.join(' · ') || '—'}</td></tr>)}
        {overview.length === 0 && <tr><td colSpan={3} className="muted">No assignments yet.</td></tr>}</tbody></table></div></div>
    </>
  );
}
