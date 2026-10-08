import Link from 'next/link';
import { requireCtx, sessionAndExams } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function TeacherDashboard({ searchParams }: { searchParams: { exam?: string } }) {
  const { sb, teacher, isAdmin } = await requireCtx();
  if (isAdmin) redirect('/admin');
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!teacher) return <div className="card"><h1 className="h2">Welcome</h1><p className="text-sm">Your login is not linked to a teacher record yet. Please ask the administrator to add your email ID in Teachers.</p></div>;
  const { data: as } = await sb.from('teacher_assignments').select('id,role,class_section_id,class_subject_id,class_sections(label),class_subjects(display_label)').eq('teacher_id', teacher.id).eq('session_id', session?.id);
  const { data: batches } = exam ? await sb.from('mark_batches').select('class_section_id,class_subject_id,status').eq('examination_id', exam.id) : { data: [] as any[] };
  const st = (a: any) => (batches || []).find((b: any) => b.class_section_id === a.class_section_id && (b.class_subject_id || null) === (a.class_subject_id || null))?.status || 'NOT STARTED';
  const rows = (as || []) as any[];
  const subj = rows.filter((r) => r.role === 'SUBJECT');
  const pend = subj.filter((r) => ['NOT STARTED', 'DRAFT'].includes(st(r))).length;
  return (
    <>
      <h1 className="h2">My dashboard</h1>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="stat"><div className="v">{new Set(rows.map((r) => r.class_section_id)).size}</div><div className="l">My classes</div></div>
        <div className="stat"><div className="v">{subj.length}</div><div className="l">My subjects</div></div>
        <div className="stat"><div className="v">{pend}</div><div className="l">Pending marks entry</div></div>
        <div className="stat"><div className="v">{subj.length - pend}</div><div className="l">Submitted marks</div></div>
      </div>
      <div className="card"><h2 className="h3">{exam?.name || 'No examination'} · {session?.label}</h2>
        {exams.length > 1 && <div className="mb-3 flex flex-wrap gap-2">{exams.map((e) => <Link key={e.id} className={`rounded-md border px-3 py-1.5 text-sm ${e.id === exam?.id ? 'border-ink bg-ink text-white' : 'border-line'}`} href={`/teacher?exam=${e.id}`}>{e.name}</Link>)}</div>}
        {rows.length === 0 ? <p className="muted">No classes are assigned to you yet.</p> :
          <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Role</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id}><td>{r.class_sections?.label}</td><td>{r.role === 'SUBJECT' ? 'Subject teacher' : 'Class teacher'}</td><td>{r.class_subjects?.display_label || '—'}</td>
                <td><span className={`chip ${st(r) === 'LOCKED' ? 'chip-ok' : st(r) === 'SUBMITTED' || st(r) === 'VERIFIED' ? 'chip-blue' : st(r) === 'DRAFT' ? 'chip-warn' : ''}`}>{st(r)}</span></td>
                <td><Link className="btn btn-sm btn-sec" href={r.role === 'SUBJECT' ? `/marks?exam=${exam?.id}&cs=${r.class_section_id}&sub=${r.class_subject_id}` : `/class-entry?exam=${exam?.id}&cs=${r.class_section_id}`}>{r.role === 'SUBJECT' ? 'Marks' : 'Attendance & grades'}</Link></td></tr>))}
          </tbody></table></div>}
      </div>
    </>
  );
}
