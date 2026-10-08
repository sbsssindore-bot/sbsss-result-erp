import Link from 'next/link';
import { requireCtx, sessionAndExams } from '@/lib/auth';
import { fetchAll, chunk } from '@/lib/db';
import { fmtNum } from '@/lib/format';
import ExamTabs from '@/components/ExamTabs';
import ClassEntryGrid from '@/components/ClassEntryGrid';
import { adminSetStatus } from '../admin/review/actions';

export default async function ClassEntry({ searchParams }: { searchParams: { exam?: string; cs?: string; msg?: string; err?: string } }) {
  const { sb, isAdmin, teacher } = await requireCtx();
  const { session, exams, exam } = await sessionAndExams(sb, { exam: searchParams.exam });
  if (!session || !exam) return <div className="card"><h1 className="h2">Attendance &amp; grades</h1><p className="muted">No examination is available.</p></div>;
  let sections: any[] = [];
  if (isAdmin) sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  else if (teacher) {
    const { data } = await sb.from('teacher_assignments').select('class_sections(id,label,class_id)').eq('teacher_id', teacher.id).eq('session_id', session.id).eq('role', 'CLASS');
    sections = (data || []).map((x: any) => x.class_sections).filter(Boolean);
  }
  const csId = sections.find((s) => s.id === searchParams.cs)?.id as string | undefined;
  const cs = sections.find((s) => s.id === csId);
  const q = (o: Record<string, string | undefined>) => { const sp = new URLSearchParams(); Object.entries({ exam: exam.id, ...o }).forEach(([k, v]) => v && sp.set(k, v)); return `/class-entry?${sp}`; };
  const head = (
    <>
      <h1 className="h2">Attendance, co-scholastic grades &amp; remarks</h1>
      <ExamTabs exams={exams} current={exam.id} base="/class-entry" params={{ cs: csId }} />
      {searchParams.msg && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{searchParams.err}</div>}
      <div className="card"><h2 className="h3">Class &amp; section</h2>
        {sections.length === 0 ? <p className="muted">{isAdmin ? 'No class sections yet.' : 'You are not assigned as a class teacher. Ask the administrator.'}</p> :
          <div className="flex flex-wrap gap-2">{sections.map((s) => <Link key={s.id} href={q({ cs: s.id })} className={`rounded-md border px-3 py-2 text-sm ${s.id === csId ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{s.label}</Link>)}</div>}</div>
    </>
  );
  if (!cs) return head;
  const enr = await fetchAll((a, b) => sb.from('student_class_enrollments').select('id,roll_number,student_id').eq('class_section_id', cs.id).eq('status', 'ACTIVE').order('roll_number').range(a, b));
  const ids = enr.map((e: any) => e.id);
  const students = ids.length ? (await sb.from('students').select('id,name').in('id', enr.map((e: any) => e.student_id))).data || [] : [];
  const att: any[] = [], co: any[] = [], rem: any[] = [];
  for (const part of chunk(ids, 40)) {
    att.push(...(await sb.from('attendance').select('*').eq('examination_id', exam.id).in('enrollment_id', part)).data || []);
    co.push(...(await sb.from('co_scholastic_marks').select('*').eq('examination_id', exam.id).in('enrollment_id', part)).data || []);
    rem.push(...(await sb.from('report_remarks').select('*').eq('examination_id', exam.id).in('enrollment_id', part)).data || []);
  }
  const { data: areaRows } = await sb.from('co_scholastic_areas').select('*').eq('session_id', session.id).eq('class_id', cs.class_id).order('display_order');
  const areas = (areaRows || []).map((a: any) => ({ id: a.id, label: a.display_label || a.name }));
  const { data: gv } = await sb.from('co_grade_values').select('value').order('sort_order');
  const { data: sts } = await sb.from('result_statuses').select('code').order('sort_order');
  const { data: rr } = exam.result_rule_id ? await sb.from('result_rules').select('rule').eq('id', exam.result_rule_id).maybeSingle() : { data: null as any };
  const { data: batch } = await sb.from('mark_batches').select('*').eq('examination_id', exam.id).eq('class_section_id', cs.id).is('class_subject_id', null).maybeSingle();
  const status: string = batch?.status || 'NONE';
  const canEdit = status !== 'LOCKED' && (isAdmin || status === 'NONE' || status === 'DRAFT');
  const rows = enr.map((e: any) => {
    const a = att.find((x) => x.enrollment_id === e.id), r = rem.find((x) => x.enrollment_id === e.id);
    return { enrId: e.id, roll: e.roll_number, name: students.find((s: any) => s.id === e.student_id)?.name || '',
      working: a?.working_days == null ? '' : fmtNum(Number(a.working_days)), present: a?.present_days == null ? '' : fmtNum(Number(a.present_days)),
      co: Object.fromEntries(co.filter((x) => x.enrollment_id === e.id).map((x) => [x.area_id, x.grade])), remarks: r?.remarks || '', status: r?.result_status || '' };
  });
  const back = q({ cs: cs.id });
  return (
    <>
      {head}
      <div className="card"><b>{cs.label}</b> · {exam.name} <span className={`chip ${status === 'LOCKED' ? 'chip-ok' : status === 'SUBMITTED' || status === 'VERIFIED' ? 'chip-blue' : status === 'DRAFT' ? 'chip-warn' : ''}`}>{status === 'NONE' ? 'NOT STARTED' : status}</span>
        {status === 'LOCKED' && <p className="muted mt-2">Locked. {isAdmin ? 'Unlock to edit.' : 'Ask the administrator to unlock.'}</p>}
        {isAdmin && batch && <div className="mt-3 flex flex-wrap gap-2">
          {status !== 'LOCKED' && <form action={adminSetStatus}><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="to" value="LOCKED" /><input type="hidden" name="back" value={back} /><button className="btn btn-sm">Lock</button></form>}
          {status !== 'DRAFT' && <form action={adminSetStatus} className="flex gap-2"><input type="hidden" name="id" value={batch.id} /><input type="hidden" name="to" value="DRAFT" /><input type="hidden" name="back" value={back} /><input name="reason" required placeholder="Reason to unlock / return" className="input !min-h-[36px] !w-56" /><button className="btn btn-sm btn-bad">Unlock / return</button></form>}</div>}
      </div>
      <ClassEntryGrid key={`${exam.id}-${cs.id}-${status}-${batch?.updated_at}`} examId={exam.id} csId={cs.id} rows={rows} areas={areas} gradeValues={(gv || []).map((g: any) => g.value)}
        statuses={(sts || []).map((s: any) => s.code)} manualStatus={rr?.rule?.mode !== 'auto'} canEdit={canEdit} isAdmin={isAdmin} batchStatus={status} />
    </>
  );
}
