import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import ExamTabs from '@/components/ExamTabs';

export default async function Reports({ searchParams }: { searchParams: { exam?: string; cs?: string } }) {
  const { sb } = await requireAdmin();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!session || !exam) return <p className="muted">No examination found.</p>;
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const cs = sections.find((s: any) => s.id === searchParams.cs);
  let list: any[] = [];
  if (cs) {
    const enr = await fetchAll((a, b) => sb.from('student_class_enrollments').select('id,roll_number,student_id').eq('class_section_id', cs.id).eq('status', 'ACTIVE').order('roll_number').range(a, b));
    const st = enr.length ? (await sb.from('students').select('id,name,scholar_number').in('id', enr.map((e: any) => e.student_id))).data || [] : [];
    list = enr.map((e: any) => ({ ...e, s: st.find((x: any) => x.id === e.student_id) }));
  }
  const pv = (extra: string) => `/admin/reports/preview?exam=${exam.id}&${extra}`;
  return (
    <>
      <h1 className="h2">Report cards</h1>
      <ExamTabs exams={exams} current={exam.id} base="/admin/reports" params={{ cs: cs?.id }} />
      <div className="card"><h2 className="h3">Class section</h2>
        <div className="flex flex-wrap gap-2">{sections.map((s: any) => <Link key={s.id} href={`/admin/reports?exam=${exam.id}&cs=${s.id}`} className={`rounded-md border px-3 py-2 text-sm ${s.id === cs?.id ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{s.label}</Link>)}
          {sections.length === 0 && <span className="muted">No class sections yet.</span>}</div></div>
      {cs && (
        <form method="get" action="/admin/reports/preview" className="card">
          <input type="hidden" name="exam" value={exam.id} /><input type="hidden" name="cs" value={cs.id} />
          <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="h3 !mb-0 flex-1">{cs.label} · {exam.name} ({list.length} students)</h2>
            <button className="btn btn-sec" type="submit">Preview selected</button><Link className="btn" href={pv(`cs=${cs.id}`)}>Generate whole class</Link></div>
          <div className="tw"><table className="t"><thead><tr><th></th><th>Roll</th><th>Scholar no.</th><th>Name</th><th></th></tr></thead><tbody>
            {list.map((e) => <tr key={e.id}><td><input type="checkbox" name="ids" value={e.id} className="h-5 w-5" aria-label={`Select ${e.s?.name}`} /></td><td>{e.roll_number}</td><td>{e.s?.scholar_number}</td><td>{e.s?.name}</td><td><Link className="btn btn-sm btn-ghost" href={pv(`cs=${cs.id}&ids=${e.id}`)}>Preview</Link></td></tr>)}
            {list.length === 0 && <tr><td colSpan={5} className="muted">No students in this class section.</td></tr>}</tbody></table></div>
        </form>)}
    </>
  );
}
