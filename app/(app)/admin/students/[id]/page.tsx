import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { saveStudent } from '../actions';

export default async function StudentForm({ params, searchParams }: { params: { id: string }; searchParams: { msg?: string; err?: string; cs?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const isNew = params.id === 'new';
  let en: any = null, st: any = null, choices: any[] = [];
  if (!isNew) {
    en = (await sb.from('student_class_enrollments').select('*').eq('id', params.id).maybeSingle()).data;
    if (!en) return <div className="card">Student not found.</div>;
    st = (await sb.from('students').select('*').eq('id', en.student_id).single()).data;
    choices = (await sb.from('student_subject_choices').select('*').eq('enrollment_id', en.id)).data || [];
  }
  const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,label,class_id').eq('session_id', session!.id).eq('status', 'ACTIVE').order('class_id').order('label').range(a, b));
  const csId = en?.class_section_id || searchParams.cs || '';
  const cs = sections.find((s: any) => s.id === csId);
  let groups: any[] = [], subs: any[] = [];
  if (cs && cs.class_id >= 11) {
    groups = (await sb.from('subject_groups').select('*').order('slot_no')).data || [];
    subs = (await sb.from('class_subjects').select('id,display_label,subject_group_id,subjects(code)').eq('session_id', session!.id).eq('class_id', cs.class_id).eq('status', 'ACTIVE').order('display_order')).data || [];
  }
  const v = (k: string) => (st ? st[k] ?? '' : '');
  return (
    <>
      <p className="mb-2 text-sm"><Link className="text-maroon underline" href="/admin/students">← All students</Link></p>
      <h1 className="h2">{isNew ? 'Add student' : `Edit ${st.name}`}</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <form action={saveStudent} className="card max-w-3xl">
        <input type="hidden" name="enrollment_id" value={en?.id || ''} /><input type="hidden" name="student_id" value={st?.id || ''} />
        <div className="grid gap-x-4 md:grid-cols-2">
          <label className="lbl">Scholar number *<input className="input" name="scholar_number" defaultValue={v('scholar_number')} required /></label>
          <label className="lbl">Admission number<input className="input" name="admission_number" defaultValue={v('admission_number')} /></label>
          <label className="lbl md:col-span-2">Student name *<input className="input" name="name" defaultValue={v('name')} required /></label>
          <label className="lbl">Father&apos;s name<input className="input" name="father_name" defaultValue={v('father_name')} /></label>
          <label className="lbl">Mother&apos;s name<input className="input" name="mother_name" defaultValue={v('mother_name')} /></label>
          <label className="lbl">Date of birth<input className="input" type="date" name="dob" defaultValue={v('dob')} /></label>
          <label className="lbl">Gender<select className="input" name="gender" defaultValue={v('gender')}><option value="">—</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
          <label className="lbl">Mobile<input className="input" name="mobile" defaultValue={v('mobile')} /></label>
          <label className="lbl">Address<input className="input" name="address" defaultValue={v('address')} /></label>
          <label className="lbl">Class section *<select className="input" name="class_section_id" defaultValue={csId} required><option value="">Choose…</option>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="lbl">Roll number *<input className="input" type="number" min={1} name="roll_number" defaultValue={en?.roll_number ?? ''} required /></label>
          {!isNew && <label className="lbl">Status<select className="input" name="status" defaultValue={en.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>}
        </div>
        {cs && cs.class_id >= 11 && (
          <div className="mt-2 border-t border-line pt-3"><h2 className="h3">Subjects (one per report-card row)</h2>
            <div className="grid gap-x-4 md:grid-cols-2">{groups.map((g) => (
              <label className="lbl" key={g.id}>{g.label}<select className="input" name={`slot_${g.id}`} defaultValue={choices.find((c) => c.subject_group_id === g.id)?.class_subject_id || ''}><option value="">— not selected —</option>
                {subs.filter((s) => s.subject_group_id === g.id).map((s) => <option key={s.id} value={s.id}>{s.display_label} {s.subjects?.code ? `(${s.subjects.code})` : ''}</option>)}</select></label>))}</div></div>)}
        {isNew && <p className="muted mb-3">For Class XI–XII, save once, then open the student again to choose subjects.</p>}
        <button className="btn">Save student</button>
      </form>
    </>
  );
}
