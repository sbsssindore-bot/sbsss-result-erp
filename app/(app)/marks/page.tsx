import Link from 'next/link';
import { requireCtx, sessionAndExams } from '@/lib/auth';
import { fetchAll, chunk } from '@/lib/db';
import { fmtNum } from '@/lib/format';
import ExamTabs from '@/components/ExamTabs';
import MarksGrid from '@/components/MarksGrid';
import { adminSetStatus } from '../admin/review/actions';

type SP = { exam?: string; cs?: string; sub?: string; msg?: string; err?: string };

export default async function MarksPage({ searchParams }: { searchParams: SP }) {
  const { sb, isAdmin, teacher } = await requireCtx();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  const terms = exams.filter((e: any) => e.type !== 'ANNUAL');
  const ex = terms.find((e: any) => e.id === exam?.id) || terms[0];
  if (!session || !ex) return <div className="card"><h1 className="h2">Marks entry</h1><p className="muted">No examination is available.</p></div>;

  // what may this user open?
  let sections: any[] = [], subjects: any[] = [];
  if (isAdmin) {
    sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  } else if (teacher) {
    const { data } = await sb.from('teacher_assignments').select('class_section_id,class_subject_id,class_sections(id,label,class_id),class_subjects(id,display_label,display_order)').eq('teacher_id', teacher.id).eq('session_id', session.id).eq('role', 'SUBJECT');
    const seen = new Set<string>();
    for (const a of (data || []) as any[]) { if (a.class_sections && !seen.has(a.class_sections.id)) { seen.add(a.class_sections.id); sections.push(a.class_sections); } subjects.push({ ...a.class_subjects, cs: a.class_section_id }); }
    sections.sort((x, y) => x.class_id - y.class_id || x.label.localeCompare(y.label));
  }
  const csId = searchParams.cs && sections.find((s) => s.id === searchParams.cs) ? searchParams.cs : undefined;
  const csRow = sections.find((s) => s.id === csId);
  if (csRow && isAdmin) {
    subjects = (await fetchAll((a, b) => sb.from('class_subjects').select('id,display_label,display_order').eq('session_id', session.id).eq('class_id', csRow.class_id).eq('kind', 'MARKS').eq('status', 'ACTIVE').order('display_order').range(a, b))).map((x: any) => ({ ...x, cs: csId }));
  }
  const subOptions = subjects.filter((s) => s.cs === csId).sort((a, b) => a.display_order - b.display_order);
  const sub = subOptions.find((s) => s.id === searchParams.sub);
  const q = (o: Record<string, string | undefined>) => { const sp = new URLSearchParams(); Object.entries({ exam: ex.id, ...o }).forEach(([k, v]) => v && sp.set(k, v)); return `/marks?${sp}`; };

  const picker = (
    <>
      <h1 className="h2">Marks entry</h1>
      <ExamTabs exams={terms} current={ex.id} base="/marks" params={{ cs: csId, sub: sub?.id }} />
      {searchParams.msg && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{searchParams.err}</div>}
      <div className="card">
        <h2 className="h3">1. Class &amp; section</h2>
        {sections.length === 0 ? <p className="muted">{isAdmin ? 'No class sections yet. Import students first.' : 'No subjects are assigned to you for this session. Ask the administrator.'}</p> :
          <div className="flex flex-wrap gap-2">{sections.map((s) => <Link key={s.id} href={q({ cs: s.id })} className={`rounded-md border px-3 py-2 text-sm ${s.id === csId ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{s.label}</Link>)}</div>}
        {csId && <><h2 className="h3 mt-4">2. Subject</h2><div className="flex flex-wrap gap-2">{subOptions.map((s) => <Link key={s.id} href={q({ cs: csId, sub: s.id })} className={`rounded-md border px-3 py-2 text-sm ${s.id === sub?.id ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{s.display_label}</Link>)}</div></>}
      </div>
    </>
  );
  if (!csId || !sub) return picker;

  // ---- load the sheet ----
  const { data: csub } = await sb.from('class_subjects').select('*').eq('id', sub.id).single();
  const { data: tpl } = await sb.from('report_card_templates').select('code').lte('min_class', csRow.class_id).gte('max_class', csRow.class_id).single();
  const { data: compRows } = await sb.from('exam_components').select('*').eq('examination_id', ex.id).eq('template_code', tpl!.code).order('display_order');
  const { data: limRows } = await sb.from('exam_component_limits').select('*').eq('class_subject_id', sub.id);
  const comps = (compRows || []).flatMap((c: any) => {
    const l = (limRows || []).find((x: any) => x.component_id === c.id);
    if (l && l.is_applicable === false) return [];
    return [{ id: c.id, label: c.label, max: Number(l && l.max_marks != null ? l.max_marks : c.max_marks) }];
  });
  let enr: any[] = await fetchAll((a, b) => sb.from('student_class_enrollments').select('id,roll_number,student_id').eq('class_section_id', csId).eq('status', 'ACTIVE').order('roll_number').range(a, b));
  if (csub?.subject_group_id) {
    const ch = await fetchAll((a, b) => sb.from('student_subject_choices').select('enrollment_id').eq('class_subject_id', sub.id).range(a, b));
    const ok = new Set(ch.map((c: any) => c.enrollment_id)); enr = enr.filter((e) => ok.has(e.id));
  }
  const students = enr.length ? (await sb.from('students').select('id,name').in('id', enr.map((e) => e.student_id))).data || [] : [];
  const marks: any[] = [];
  for (const part of chunk(enr.map((e) => e.id), 40)) marks.push(...await fetchAll((a, b) => sb.from('marks').select('enrollment_id,component_id,value,is_absent').eq('examination_id', ex.id).eq('class_subject_id', sub.id).in('enrollment_id', part).range(a, b)));
  const { data: batch } = await sb.from('mark_batches').select('*').eq('examination_id', ex.id).eq('class_section_id', csId).eq('class_subject_id', sub.id).maybeSingle();
  const { data: bandRows } = await sb.from('grade_scale_bands').select('grade,min_percentage').eq('scale_id', ex.grade_scale_id);
  const bands = (bandRows || []).map((b: any) => ({ grade: b.grade, min: Number(b.min_percentage) }));
  const status: string = batch?.status || 'NONE';
  const canEdit = status !== 'LOCKED' && (isAdmin || status === 'NONE' || status === 'DRAFT');
  const rows = enr.map((e) => ({
    enrId: e.id, roll: e.roll_number, name: students.find((s: any) => s.id === e.student_id)?.name || '',
    values: Object.fromEntries(comps.map((c: any) => {
      const m = marks.find((x) => x.enrollment_id === e.id && x.component_id === c.id);
      return [c.id, !m ? '' : m.is_absent ? 'AB' : m.value == null ? '' : fmtNum(Number(m.value))];
    })),
  }));
  const chipCls = status === 'LOCKED' ? 'chip-ok' : status === 'SUBMITTED' || status === 'VERIFIED' ? 'chip-blue' : status === 'DRAFT' ? 'chip-warn' : '';
  return (
    <>
      {picker}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2"><b>{csub?.display_label}</b> · {csRow.label} · {ex.name} <span className={`chip ${chipCls}`}>{status === 'NONE' ? 'NOT STARTED' : status}</span></div>
        {status === 'LOCKED' && <p className="muted mt-2">These marks are locked. {isAdmin ? 'Unlock them from Review & Lock to edit.' : 'Ask the administrator to unlock them.'}</p>}
        {status === 'SUBMITTED' && !isAdmin && <p className="muted mt-2">Submitted for review. Editing is closed until the administrator returns it.</p>}
        {isAdmin && batch && (
          <div className="mt-3 flex flex-wrap gap-2">
            {status === 'SUBMITTED' && <form action={adminSetStatus}><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="to" value="VERIFIED" /><input type="hidden" name="back" value={q({ cs: csId, sub: sub.id })} /><button className="btn btn-sm btn-sec">Verify</button></form>}
            {(status === 'SUBMITTED' || status === 'VERIFIED' || status === 'DRAFT') && <form action={adminSetStatus}><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="to" value="LOCKED" /><input type="hidden" name="back" value={q({ cs: csId, sub: sub.id })} /><button className="btn btn-sm">Lock</button></form>}
            {(status === 'LOCKED' || status === 'VERIFIED' || status === 'SUBMITTED') && <form action={adminSetStatus} className="flex gap-2"><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="to" value="DRAFT" /><input type="hidden" name="back" value={q({ cs: csId, sub: sub.id })} /><input name="reason" required placeholder="Reason to unlock / return" className="input !min-h-[36px] !w-56" /><button className="btn btn-sm btn-bad">Unlock / return</button></form>}
          </div>)}
      </div>
      <MarksGrid key={`${ex.id}-${sub.id}-${status}-${batch?.updated_at}`} examId={ex.id} csId={csId} subId={sub.id} comps={comps} rows={rows} bands={bands} canEdit={canEdit} isAdmin={isAdmin} status={status} />
    </>
  );
}
