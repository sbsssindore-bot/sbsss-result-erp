import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import { loadCards } from '@/lib/reportData';
import { renderCard, REPORT_CSS } from '@/lib/reportCard';
import { logoUrl } from '@/lib/logo';
import { ROMAN } from '@/lib/format';
import PrintButton from '@/components/PrintButton';

export const maxDuration = 60;
const MAX_CARDS = 60;

export default async function Preview({ searchParams }: { searchParams: { exam?: string; cs?: string; class_id?: string; ids?: string | string[] } }) {
  const { sb } = await requireAdmin();
  const { exam, settings } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!exam) return <div className="card">Examination not found.</div>;
  let ids = ([] as string[]).concat(searchParams.ids || []).flatMap((s) => s.split(',')).filter(Boolean);
  if (!ids.length && searchParams.class_id) {
    const classId = Number(searchParams.class_id);
    if (!Number.isInteger(classId) || classId < 1 || classId > 12) return <div className="card">Invalid class.</div>;
    const sections = await fetchAll((a, b) => sb.from('class_sections').select('id').eq('session_id', exam.session_id).eq('class_id', classId).eq('status', 'ACTIVE').range(a, b));
    const sectionIds = sections.map((s: any) => s.id);
    if (sectionIds.length) ids = (await fetchAll((a, b) => sb.from('student_class_enrollments').select('id,roll_number').in('class_section_id', sectionIds).eq('status', 'ACTIVE').order('roll_number').range(a, b))).map((e: any) => e.id);
  } else if (!ids.length && searchParams.cs) {
    ids = (await fetchAll((a, b) => sb.from('student_class_enrollments').select('id').eq('class_section_id', searchParams.cs!).eq('status', 'ACTIVE').order('roll_number').range(a, b))).map((e: any) => e.id);
  }
  if (!ids.length) return <div className="card"><p>No students selected.</p><Link className="text-maroon underline" href="/admin/reports">Back</Link></div>;
  const capped = ids.length > MAX_CARDS;
  ids = ids.slice(0, MAX_CARDS);
  const cards = await loadCards(sb, exam.id, ids);
  const html = cards.map(renderCard).join('');
  const qs = new URLSearchParams({ exam: exam.id });
  if (searchParams.cs) qs.set('cs', searchParams.cs);
  if (searchParams.class_id) qs.set('class_id', searchParams.class_id);
  if (ids.length && searchParams.ids) qs.set('ids', ids.join(','));
  const incomplete = cards.filter((c) => /incomplete/.test(c.summaryValue)).length;
  const backQuery = searchParams.class_id ? `&class_id=${searchParams.class_id}` : searchParams.cs ? `&cs=${searchParams.cs}` : '';
  const className = searchParams.class_id ? ROMAN[Number(searchParams.class_id)] : '';
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/admin/reports?exam=${exam.id}${backQuery}`} className="btn btn-ghost">← Back</Link>
        <span className="flex-1 text-sm"><b>{cards.length}</b> report card(s){className ? ` · Class ${className}` : ''} · {exam.name}{incomplete ? ` · ${incomplete} with incomplete marks` : ''}</span>
        <PrintButton label="Print" /><a className="btn btn-sec" href={`/api/report-word?${qs}`}>Download Word</a><a className="btn" href={`/api/report-pdf?${qs}`}>Download PDF</a>
      </div>
      {capped && <div className="no-print mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Showing the first {MAX_CARDS} cards. This class has more students; generate smaller groups for the rest.</div>}
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div className="overflow-x-auto bg-slate-300 p-3" style={{ ['--logo' as any]: `url(${logoUrl(settings)})` }} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
