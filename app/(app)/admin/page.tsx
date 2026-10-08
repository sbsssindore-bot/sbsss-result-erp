import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import ExamTabs from '@/components/ExamTabs';

export default async function AdminDashboard({ searchParams }: { searchParams: { exam?: string } }) {
  const { sb } = await requireAdmin();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!session) return <p>No academic session found. Run the database migrations.</p>;
  const [{ count: students }, { count: teachers }, sections, enr, batches, pending] = await Promise.all([
    sb.from('student_class_enrollments').select('id', { count: 'exact', head: true }).eq('session_id', session.id).eq('status', 'ACTIVE'),
    sb.from('teachers').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').range(a, b)),
    fetchAll((a, b) => sb.from('student_class_enrollments').select('class_section_id').eq('session_id', session.id).eq('status', 'ACTIVE').range(a, b)),
    exam ? fetchAll((a, b) => sb.from('mark_batches').select('status,class_subject_id').eq('examination_id', exam.id).range(a, b)) : Promise.resolve([] as any[]),
    sb.from('teacher_assignments').select('id', { count: 'exact', head: true }).eq('session_id', session.id).eq('role', 'SUBJECT'),
  ]);
  const count = new Map<string, number>(); enr.forEach((e: any) => count.set(e.class_section_id, (count.get(e.class_section_id) || 0) + 1));
  const subj = batches.filter((b: any) => b.class_subject_id);
  const n = (s: string) => subj.filter((b: any) => b.status === s).length;
  const started = subj.length;
  const pendingN = Math.max(0, (pending.count || 0) - n('SUBMITTED') - n('VERIFIED') - n('LOCKED'));
  const cards: [string | number, string][] = [
    [students || 0, 'Total students'], [teachers || 0, 'Total teachers'], [sections.length, 'Active class sections'],
    [session.label, 'Current session'], [exam?.name || '—', 'Current examination'], [pendingN, 'Pending marks sheets'],
    [n('SUBMITTED') + n('VERIFIED'), 'Submitted marks sheets'], [n('LOCKED'), 'Locked results'],
  ];
  const byClass = new Map<number, { label: string; cs: any[] }>();
  sections.forEach((s: any) => { const g = byClass.get(s.class_id) || { label: `Class ${s.class_id}`, cs: [] }; g.cs.push(s); byClass.set(s.class_id, g); });
  return (
    <>
      <h1 className="h2">Dashboard</h1>
      <ExamTabs exams={exams} current={exam?.id} base="/admin" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([v, l]) => <div key={l} className="stat"><div className="v">{v}</div><div className="l">{l}</div></div>)}
      </div>
      <div className="card"><h2 className="h3">Students by class and section</h2>
        {sections.length === 0 ? <p className="muted">No class sections yet. Import students or create sections under Classes &amp; Sections.</p> :
          <div className="tw"><table className="t"><thead><tr><th>Class / section</th><th>Students</th><th></th></tr></thead><tbody>
            {sections.map((s: any) => { const c = count.get(s.id) || 0; return (
              <tr key={s.id}><td>{s.label}</td><td>{c}</td><td><div className="h-2 w-40 overflow-hidden rounded bg-slate-200"><div className="h-full bg-emerald-600" style={{ width: `${Math.min(100, c * 2.5)}%` }} /></div></td></tr>); })}
          </tbody></table></div>}
      </div>
      <div className="card"><h2 className="h3">Marks entry progress · {exam?.name}</h2>
        <p className="muted">Sheets started: {started} · Draft: {n('DRAFT')} · Submitted: {n('SUBMITTED')} · Verified: {n('VERIFIED')} · Locked: {n('LOCKED')}</p></div>
    </>
  );
}
