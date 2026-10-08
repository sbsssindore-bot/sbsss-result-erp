import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import ExamTabs from '@/components/ExamTabs';
import Flash from '@/components/Flash';
import { adminSetStatus, lockAllSubmitted } from './actions';

export default async function Review({ searchParams }: { searchParams: { exam?: string; msg?: string; err?: string; status?: string } }) {
  const { sb } = await requireAdmin();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!session || !exam) return <p className="muted">No examination found.</p>;
  const batches = await fetchAll((a, b) => sb.from('mark_batches').select('id,status,class_section_id,class_subject_id,unlock_reason,class_sections(label,class_id),class_subjects(display_label)').eq('examination_id', exam.id).range(a, b));
  const assigns = await fetchAll((a, b) => sb.from('teacher_assignments').select('class_section_id,class_subject_id,role,teachers(name),class_sections(label,class_id),class_subjects(display_label)').eq('session_id', session.id).range(a, b));
  const rows: any[] = batches.map((b: any) => ({ ...b, key: b.class_section_id + '|' + (b.class_subject_id || '') }));
  const have = new Set(rows.map((r) => r.key));
  for (const a of assigns as any[]) { const k = a.class_section_id + '|' + (a.class_subject_id || ''); if (!have.has(k)) { have.add(k); rows.push({ id: null, status: 'NOT STARTED', class_sections: a.class_sections, class_subjects: a.class_subjects, class_section_id: a.class_section_id, class_subject_id: a.class_subject_id, key: k }); } }
  const who = (r: any) => (assigns as any[]).filter((a) => a.class_section_id === r.class_section_id && (a.class_subject_id || null) === (r.class_subject_id || null)).map((a) => a.teachers?.name).filter(Boolean).join(', ') || '—';
  const f = searchParams.status;
  const shown = rows.filter((r) => !f || r.status === f).sort((a, b) => (a.class_sections?.class_id - b.class_sections?.class_id) || String(a.class_sections?.label).localeCompare(b.class_sections?.label));
  const back = `/admin/review?exam=${exam.id}`;
  return (
    <>
      <h1 className="h2">Review &amp; Lock</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <ExamTabs exams={exams} current={exam.id} base="/admin/review" />
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {['', 'NOT STARTED', 'DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'].map((s) => <Link key={s} href={`/admin/review?exam=${exam.id}${s ? `&status=${encodeURIComponent(s)}` : ''}`} className={`rounded-md border px-3 py-1.5 text-sm ${(f || '') === s ? 'border-ink bg-ink text-white' : 'border-line'}`}>{s || 'All'}</Link>)}
          <form action={lockAllSubmitted} className="ml-auto"><input type="hidden" name="exam" value={exam.id} /><button className="btn btn-sm">Lock all submitted &amp; verified</button></form>
        </div>
        <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {shown.map((r) => (
            <tr key={r.key}><td>{r.class_sections?.label}</td><td>{r.class_subject_id ? r.class_subjects?.display_label : 'Attendance & grades'}</td><td>{who(r)}</td>
              <td><span className={`chip ${r.status === 'LOCKED' ? 'chip-ok' : r.status === 'SUBMITTED' || r.status === 'VERIFIED' ? 'chip-blue' : r.status === 'DRAFT' ? 'chip-warn' : ''}`}>{r.status}</span></td>
              <td className="flex flex-wrap gap-1">
                <Link className="btn btn-sm btn-ghost" href={r.class_subject_id ? `/marks?exam=${exam.id}&cs=${r.class_section_id}&sub=${r.class_subject_id}` : `/class-entry?exam=${exam.id}&cs=${r.class_section_id}`}>Open</Link>
                {r.id && r.status === 'SUBMITTED' && <form action={adminSetStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value="VERIFIED" /><input type="hidden" name="back" value={back} /><button className="btn btn-sm btn-sec">Verify</button></form>}
                {r.id && r.status !== 'LOCKED' && r.status !== 'DRAFT' && <form action={adminSetStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value="LOCKED" /><input type="hidden" name="back" value={back} /><button className="btn btn-sm">Lock</button></form>}
              </td></tr>))}
          {shown.length === 0 && <tr><td colSpan={5} className="muted">Nothing to show.</td></tr>}
        </tbody></table></div>
        <p className="muted mt-2">To unlock or return a sheet, open it and give a reason. Every change is recorded in the audit log.</p>
      </div>
    </>
  );
}
