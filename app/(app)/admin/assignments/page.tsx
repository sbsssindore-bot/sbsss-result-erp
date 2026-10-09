import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { groupKey, groupLabel, groupSections } from '@/lib/assignGroups';
import { assignSubjectTeacher, assignClassTeacher, removeAssignment } from './actions';

export default async function Assignments({ searchParams }: { searchParams: { teacher?: string; msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  if (!session) return <p>No session.</p>;
  const teachers = await fetchAll((a, b) => sb.from('teachers').select('id,name,employee_id,status').order('name').range(a, b));
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id,section_id,stream_id,sections(name),streams(name),classes(roman)').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const subs = await fetchAll((a, b) => sb.from('class_subjects').select('class_id,subjects(name)').eq('session_id', session.id).eq('status', 'ACTIVE').eq('kind', 'MARKS').range(a, b));
  const subjectNames = [...new Set(subs.map((s: any) => s.subjects?.name).filter(Boolean))].sort() as string[];
  const all = await fetchAll((a, b) => sb.from('teacher_assignments').select('id,teacher_id,role,class_section_id,class_sections(id,label,class_id,section_id,stream_id,sections(name),streams(name),classes(roman)),class_subjects(display_label),teachers(name)').eq('session_id', session.id).range(a, b));
  const tid = teachers.find((t: any) => t.id === searchParams.teacher)?.id || teachers[0]?.id;
  const groups = groupSections(sections as any);
  // Simplified display: one line per (class-section group × role × subject); the stream sections underneath are listed in "Streams".
  type Row = { ids: string[]; label: string; class_id: number; role: string; subject: string; streams: string[] };
  const collapse = (list: any[]): Row[] => {
    const m = new Map<string, Row>();
    for (const a of list) {
      const cs = a.class_sections; if (!cs) continue;
      const k = `${groupKey(cs)}|${a.role}|${a.class_subjects?.display_label || ''}`;
      const r = m.get(k) || { ids: [], label: groupLabel(cs), class_id: cs.class_id, role: a.role, subject: a.class_subjects?.display_label || '', streams: [] };
      r.ids.push(a.id); if (cs.stream_id && cs.streams?.name) r.streams.push(cs.streams.name);
      m.set(k, r);
    }
    return [...m.values()].sort((x, y) => x.class_id - y.class_id || x.label.localeCompare(y.label) || x.role.localeCompare(y.role) || x.subject.localeCompare(y.subject));
  };
  const mine = collapse((all as any[]).filter((a) => a.teacher_id === tid));
  const byCs = new Map<string, { label: string; class_id: number; ct: string[]; st: string[] }>();
  (all as any[]).forEach((a) => {
    const cs = a.class_sections; if (!cs) return; const k = groupKey(cs);
    const g = byCs.get(k) || { label: groupLabel(cs), class_id: cs.class_id, ct: [], st: [] };
    const who = a.teachers?.name;
    if (a.role === 'CLASS') { if (!g.ct.includes(who)) g.ct.push(who); }
    else { const t = `${a.class_subjects?.display_label}${cs.stream_id && cs.streams?.name ? ` [${cs.streams.name}]` : ''}: ${who}`; if (!g.st.includes(t)) g.st.push(t); }
    byCs.set(k, g);
  });
  const overview = [...byCs.values()].sort((x, y) => x.class_id - y.class_id || String(x.label).localeCompare(y.label));
  const Teacher = <label className="lbl max-w-sm">Teacher<select className="input" name="teacher" defaultValue={tid} required>{teachers.filter((t: any) => t.status === 'ACTIVE' || t.id === tid).map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.employee_id})</option>)}</select></label>;
  const Sections = <div className="mb-3"><div className="muted mb-1">Class sections (tick as many as needed). For XI–XII one tick covers every stream of that section; each subject is attached only to the streams that offer it.</div><div>{groups.map((g) => <label key={g.key} className="pick" title={g.streams.length ? `Includes: ${g.streams.join(', ')}` : undefined}><input type="checkbox" name="cs" value={g.ids.join(',')} /> {g.label}{g.ids.length > 1 && <span className="muted"> (all {g.ids.length} streams)</span>}</label>)}</div></div>;
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
        <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Role</th><th>Subject</th><th>Streams</th><th></th></tr></thead><tbody>
          {mine.map((a) => <tr key={a.ids.join()}><td>{a.label}</td><td>{a.role === 'SUBJECT' ? 'Subject teacher' : <b>Class teacher</b>}</td><td>{a.subject || '—'}</td><td className="muted">{a.streams.join(', ') || '—'}</td>
            <td><form action={removeAssignment}><input type="hidden" name="id" value={a.ids.join(',')} /><input type="hidden" name="teacher" value={tid} /><button className="btn btn-sm btn-ghost">Remove</button></form></td></tr>)}
          {mine.length === 0 && <tr><td colSpan={5} className="muted">No assignments yet.</td></tr>}</tbody></table></div></div>

      <div className="card"><h2 className="h3">Who teaches what</h2><div className="tw"><table className="t"><thead><tr><th>Class</th><th>Class teacher</th><th>Subject teachers</th></tr></thead><tbody>
        {overview.map((g) => <tr key={g.label + g.class_id}><td>{g.label}</td><td>{g.ct.join(', ') || '—'}</td><td className="wrap">{g.st.join(' · ') || '—'}</td></tr>)}
        {overview.length === 0 && <tr><td colSpan={3} className="muted">No assignments yet.</td></tr>}</tbody></table></div></div>
    </>
  );
}
