import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { deactivateEnrollment } from './actions';

const PAGE = 25;
export default async function Students({ searchParams }: { searchParams: { q?: string; cs?: string; page?: string; show?: string; msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  if (!session) return <p>No session.</p>;
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const page = Math.max(1, Number(searchParams.page) || 1);
  let q = sb.from('student_class_enrollments').select('id,roll_number,status,class_section_id,students!inner(id,scholar_number,name,father_name,mother_name),class_sections!inner(label,class_id)', { count: 'exact' })
    .eq('session_id', session.id).eq('status', searchParams.show === 'inactive' ? 'INACTIVE' : 'ACTIVE');
  if (searchParams.cs) q = q.eq('class_section_id', searchParams.cs);
  const term = (searchParams.q || '').trim().replace(/[%,()]/g, '');
  if (term) q = q.or(`name.ilike.%${term}%,scholar_number.ilike.%${term}%,father_name.ilike.%${term}%`, { referencedTable: 'students' });
  const { data, count, error } = await q.order('class_section_id').order('roll_number').range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data || []) as any[];
  const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
  const link = (p: number) => { const sp = new URLSearchParams(); if (searchParams.q) sp.set('q', searchParams.q); if (searchParams.cs) sp.set('cs', searchParams.cs); if (searchParams.show) sp.set('show', searchParams.show); sp.set('page', String(p)); return `/admin/students?${sp}`; };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="h2 !mb-0 flex-1">Students · {session.label}</h1>
        <Link href="/admin/students/new" className="btn">Add student</Link><Link href="/admin/import/students" className="btn btn-sec">Import Students</Link></div>
      <Flash msg={searchParams.msg} err={searchParams.err || error?.message} />
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <label className="lbl !mb-0 min-w-[180px] flex-1">Search<input className="input" name="q" defaultValue={searchParams.q} placeholder="Name, scholar no., father" /></label>
        <label className="lbl !mb-0 min-w-[160px]">Class section<select className="input" name="cs" defaultValue={searchParams.cs || ''}><option value="">All</option>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="lbl !mb-0">Show<select className="input" name="show" defaultValue={searchParams.show || 'active'}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <button className="btn">Filter</button>
      </form>
      <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Roll</th><th>Scholar no.</th><th>Name</th><th>Father</th><th>Mother</th><th></th></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.id}><td>{r.class_sections.label}</td><td>{r.roll_number ?? '—'}</td><td>{r.students.scholar_number}</td><td>{r.students.name}</td><td>{r.students.father_name}</td><td>{r.students.mother_name}</td>
            <td className="flex gap-1"><Link className="btn btn-sm btn-ghost" href={`/admin/students/${r.id}`}>Edit</Link><Link className="btn btn-sm btn-sec" href={`/admin/reports/preview?cs=${r.class_section_id}&ids=${r.id}`}>Report card</Link>
              <form action={deactivateEnrollment}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'} /><button className="btn btn-sm btn-ghost">{r.status === 'ACTIVE' ? 'Deactivate' : 'Re-activate'}</button></form></td></tr>))}
        {rows.length === 0 && <tr><td colSpan={7} className="muted">No students found. Add one or use Bulk import.</td></tr>}
      </tbody></table></div>
      <div className="mt-3 flex items-center gap-3 text-sm"><span className="muted">{count || 0} student(s) · page {page} of {pages}</span>
        {page > 1 && <Link className="btn btn-sm btn-ghost" href={link(page - 1)}>Previous</Link>}{page < pages && <Link className="btn btn-sm btn-ghost" href={link(page + 1)}>Next</Link>}</div>
    </>
  );
}
