import Link from 'next/link';
import { requireCtx, sessionAndExams } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function TeacherDashboard({ searchParams }: { searchParams: { exam?: string } }) {
  const { sb, teacher, isAdmin } = await requireCtx();
  if (isAdmin) redirect('/admin');
  const { session, exams, exam: selectedExam } = await sessionAndExams(sb, { exam: searchParams.exam });
  // Keep the dashboard aligned with marks entry, which uses term exams (not Annual) for subject batches.
  const termExams = exams.filter((e: any) => e.type !== 'ANNUAL');
  const exam = termExams.find((e: any) => e.id === selectedExam?.id) || termExams[0] || selectedExam;
  if (!teacher) return <div className="card"><h1 className="h2">Welcome</h1><p className="text-sm">Your login is not linked to a teacher record yet. Please ask the administrator to add your email ID in Teachers.</p></div>;

  const { data: as } = await sb.from('teacher_assignments').select('id,role,class_section_id,class_subject_id,class_sections(label),class_subjects(display_label)').eq('teacher_id', teacher.id).eq('session_id', session?.id);
  const { data: gradeAssignments } = await sb.from('teacher_grade_assignments')
    .select('id,class_id,area_id,classes(roman),co_scholastic_areas(name,display_label)')
    .eq('teacher_id', teacher.id)
    .eq('session_id', session?.id);
  const gradeClassIds = [...new Set((gradeAssignments || []).map((a: any) => a.class_id))];
  const { data: gradeSections } = gradeClassIds.length && session
    ? await sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').in('class_id', gradeClassIds).order('class_id').order('label')
    : { data: [] as any[] };

  const { data: batches } = exam ? await sb.from('mark_batches').select('class_section_id,class_subject_id,status').eq('examination_id', exam.id) : { data: [] as any[] };
  const st = (a: any) => (batches || []).find((b: any) => b.class_section_id === a.class_section_id && (b.class_subject_id || null) === (a.class_subject_id || null))?.status || 'NOT STARTED';
  const rows = (as || []) as any[];
  const classTeacherRows = rows.filter((r) => r.role === 'CLASS');
  const classTeacherSectionIds = [...new Set(classTeacherRows.map((r) => r.class_section_id))];
  const classTeacherSections = classTeacherSectionIds.length && session
    ? (await sb.from('class_sections').select('id,label,class_id').in('id', classTeacherSectionIds)).data || []
    : [];
  const classIds = [...new Set(classTeacherSections.map((s: any) => s.class_id))];
  const { data: classSubjects } = classIds.length && session
    ? await sb.from('class_subjects').select('id,class_id,display_label,kind,status').eq('session_id', session.id).in('class_id', classIds).eq('kind', 'MARKS').eq('status', 'ACTIVE').order('display_order')
    : { data: [] as any[] };
  const resultSubjects = (classSubjects || []) as any[];
  const resultBatches = (batches || []) as any[];
  const resultReadiness = (classTeacherSections as any[]).map((section: any) => {
    const subjectsForClass = resultSubjects.filter((s) => s.class_id === section.class_id);
    const statuses = subjectsForClass.map((subject) => {
      const batch = resultBatches.find((b: any) => b.class_section_id === section.id && b.class_subject_id === subject.id);
      const status = batch?.status || 'NOT STARTED';
      return { ...subject, status };
    });
    const readyCount = statuses.filter((s) => ['SUBMITTED', 'VERIFIED', 'LOCKED'].includes(s.status)).length;
    const pendingCount = statuses.length - readyCount;
    return { ...section, statuses, readyCount, pendingCount, ready: statuses.length > 0 && pendingCount === 0 };
  });
  const subj = rows.filter((r) => r.role === 'SUBJECT');
  const pend = subj.filter((r) => ['NOT STARTED', 'DRAFT'].includes(st(r))).length;
  const gradeRows = (gradeAssignments || []) as any[];
  const gradeLinks = gradeRows.flatMap((a: any) => (gradeSections || []).filter((s: any) => s.class_id === a.class_id).map((s: any) => ({ ...a, section: s })));
  return (
    <>
      <h1 className="h2">My dashboard</h1>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="stat"><div className="v">{new Set([...rows.map((r) => r.class_section_id), ...(gradeSections || []).map((s: any) => s.id)]).size}</div><div className="l">My classes</div></div>
        <div className="stat"><div className="v">{subj.length + gradeRows.length}</div><div className="l">My subjects & activities</div></div>
        <div className="stat"><div className="v">{pend}</div><div className="l">Pending marks entry</div></div>
        <div className="stat"><div className="v">{subj.length - pend}</div><div className="l">Submitted marks</div></div>
      </div>
      <div className="card"><h2 className="h3">{exam?.name || 'No examination'} · {session?.label}</h2>
        {exams.length > 1 && <div className="mb-3 flex flex-wrap gap-2">{exams.map((e) => <Link key={e.id} className={`rounded-md border px-3 py-1.5 text-sm ${e.id === exam?.id ? 'border-ink bg-ink text-white' : 'border-line'}`} href={`/teacher?exam=${e.id}`}>{e.name}</Link>)}</div>}
        {rows.length === 0 ? <p className="muted">No subject/class-teacher assignments found.</p> :
          <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Role</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id}><td>{r.class_sections?.label}</td><td>{r.role === 'SUBJECT' ? 'Subject teacher' : 'Class teacher'}</td><td>{r.class_subjects?.display_label || '—'}</td>
                <td><span className={`chip ${st(r) === 'LOCKED' ? 'chip-ok' : st(r) === 'SUBMITTED' || st(r) === 'VERIFIED' ? 'chip-blue' : st(r) === 'DRAFT' ? 'chip-warn' : ''}`}>{st(r)}</span></td>
                <td><Link className="btn btn-sm btn-sec" href={r.role === 'SUBJECT' ? `/marks?exam=${exam?.id}&cs=${r.class_section_id}&sub=${r.class_subject_id}` : `/class-entry?exam=${exam?.id}&cs=${r.class_section_id}`}>{r.role === 'SUBJECT' ? 'Marks' : 'Attendance & grades'}</Link></td></tr>))}
          </tbody></table></div>}
      </div>
      {resultReadiness.length > 0 && <div className="card mt-4">
        <h2 className="h3">My Class Result Readiness</h2>
        <p className="muted mb-3">Check which subjects have submitted marks for your class. Submitted, verified, or locked marks count as ready; not-started and draft entries remain pending.</p>
        <div className="space-y-4">
          {resultReadiness.map((section: any) => (
            <div key={section.id} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{section.label}</h3>
                <span className={`chip ${section.ready ? 'chip-ok' : 'chip-warn'}`}>{section.ready ? 'RESULT READY' : `${section.pendingCount} SUBJECT(S) PENDING`}</span>
              </div>
              <p className="muted mb-2 text-sm">{section.readyCount} of {section.statuses.length} subjects ready</p>
              <div className="tw"><table className="t"><thead><tr><th>Subject</th><th>Status</th></tr></thead><tbody>
                {section.statuses.map((subject: any) => <tr key={subject.id}><td>{subject.display_label}</td><td><span className={`chip ${['SUBMITTED','VERIFIED','LOCKED'].includes(subject.status) ? 'chip-ok' : subject.status === 'DRAFT' ? 'chip-warn' : ''}`}>{subject.status}</span></td></tr>)}
              </tbody></table></div>
            </div>
          ))}
        </div>
      </div>}
      {gradeRows.length > 0 && <div className="card mt-4">
        <h2 className="h3">My activity grade assignments</h2>
        <p className="muted mb-3">Only the activities assigned to you are editable.</p>
        <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Activity</th><th></th></tr></thead><tbody>
          {gradeLinks.map((a: any) => <tr key={`${a.id}-${a.section.id}`}><td>{a.section.label}</td><td>{a.co_scholastic_areas?.display_label || a.co_scholastic_areas?.name || 'Activity'}</td><td><Link className="btn btn-sm btn-sec" href={`/class-entry?exam=${exam?.id}&cs=${a.section.id}`}>Enter activity grades</Link></td></tr>)}
        </tbody></table></div>
      </div>}
    </>
  );
}
