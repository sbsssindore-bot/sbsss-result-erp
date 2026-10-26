import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import { ROMAN } from '@/lib/format';
import ExamTabs from '@/components/ExamTabs';

export default async function Reports({ searchParams }: { searchParams: { exam?: string; cs?: string; class_id?: string } }) {
  const { sb } = await requireAdmin();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!session || !exam) return <p className="muted">No examination found.</p>;
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const legacySection = sections.find((s: any) => s.id === searchParams.cs);
  const selectedClassId = searchParams.class_id ? Number(searchParams.class_id) : legacySection?.class_id;
  const classIds = [...new Set(sections.map((s: any) => Number(s.class_id)))].sort((a, b) => a - b);
  const classOptions = classIds.map((classId) => ({
      id: classId,
      label: classId >= 1 && classId <= 12 ? ROMAN[classId] : String(classId),
      sections: sections.filter((s: any) => Number(s.class_id) === classId),
    }));
  const selected = classOptions.find((x) => x.id === selectedClassId);
  let list: any[] = [];
  if (selected) {
    const sectionIds = selected.sections.map((s: any) => s.id);
    const enr = sectionIds.length ? await fetchAll((a, b) => sb.from('student_class_enrollments').select('id,roll_number,student_id,class_section_id').in('class_section_id', sectionIds).eq('status', 'ACTIVE').order('roll_number').range(a, b)) : [];
    const st = enr.length ? (await sb.from('students').select('id,name,scholar_number').in('id', [...new Set(enr.map((e: any) => e.student_id))])).data || [] : [];
    list = enr.map((e: any) => ({ ...e, s: st.find((x: any) => x.id === e.student_id), section: selected.sections.find((x: any) => x.id === e.class_section_id) }));
  }
  const pv = (extra: string) => `/admin/reports/preview?exam=${exam.id}&${extra}`;
  return (
    <>
      <h1 className="h2">Report cards</h1>
      <ExamTabs exams={exams} current={exam.id} base="/admin/reports" params={{ class_id: selected?.id ? String(selected.id) : undefined }} />
      <div className="card"><h2 className="h3">Class</h2>
        <div className="flex flex-wrap gap-2">{classOptions.map((c) => <Link key={c.id} href={`/admin/reports?exam=${exam.id}&class_id=${c.id}`} className={`rounded-md border px-3 py-2 text-sm ${c.id === selected?.id ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{c.label}</Link>)}
          {classOptions.length === 0 && <span className="muted">No class sections yet.</span>}</div>
      </div>
      {selected && (
        <form method="get" action="/admin/reports/preview" className="card">
          <input type="hidden" name="exam" value={exam.id} /><input type="hidden" name="class_id" value={selected.id} />
          <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="h3 !mb-0 flex-1">Class {selected.label} · {exam.name} ({list.length} students)</h2>
            <a className="btn btn-sec" href={`/admin/reports/export?exam=${encodeURIComponent(exam.id)}&class_id=${selected.id}`}>Download Excel Backup</a>
            <a className="btn btn-sec" href={`/admin/reports/teacher-print?exam=${encodeURIComponent(exam.id)}&class_id=${selected.id}`}>Download Class Teacher Print Sheet</a>
            <button className="btn btn-sec" type="submit">Preview selected</button><Link className="btn" href={pv(`class_id=${selected.id}`)}>Generate whole class</Link></div>
          <p className="muted mb-3">Download a class-wise Excel backup of entered marks for emergency record-keeping.</p>
          <div className="tw"><table className="t"><thead><tr><th></th><th>Roll</th><th>Scholar no.</th><th>Name</th><th>Stream / Section</th><th></th></tr></thead><tbody>
            {list.map((e) => <tr key={e.id}><td><input type="checkbox" name="ids" value={e.id} className="h-5 w-5" aria-label={`Select ${e.s?.name}`} /></td><td>{e.roll_number}</td><td>{e.s?.scholar_number}</td><td>{e.s?.name}</td><td>{e.section?.label || ''}</td><td><Link className="btn btn-sm btn-ghost" href={pv(`class_id=${selected.id}&ids=${e.id}`)}>Preview</Link></td></tr>)}
            {list.length === 0 && <tr><td colSpan={6} className="muted">No students in this class.</td></tr>}</tbody></table></div>
        </form>)}
    </>
  );
}
