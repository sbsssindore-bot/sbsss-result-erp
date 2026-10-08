import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { saveExam } from '../actions';

export default async function ExamConfig({ params, searchParams }: { params: { id: string }; searchParams: { msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { data: ex } = await sb.from('examinations').select('*').eq('id', params.id).maybeSingle();
  if (!ex) return <div className="card">Examination not found.</div>;
  const comps = await fetchAll((a, b) => sb.from('exam_components').select('*').eq('examination_id', ex.id).order('template_code').order('display_order').range(a, b));
  const { data: tpls } = await sb.from('report_card_templates').select('code,name').order('code');
  const { data: rules } = await sb.from('result_rules').select('id,name').order('name');
  const subs = await fetchAll((a, b) => sb.from('class_subjects').select('id,display_label,class_id,subject_group_id,subjects(code)').eq('session_id', ex.session_id).eq('status', 'ACTIVE').gte('class_id', 11).order('class_id').order('display_order').range(a, b));
  const lims = await fetchAll((a, b) => sb.from('exam_component_limits').select('*').in('component_id', comps.map((c: any) => c.id).concat(['00000000-0000-0000-0000-000000000000'])).range(a, b));
  const { data: ar } = ex.type === 'ANNUAL' ? await sb.from('annual_rules').select('*').eq('examination_id', ex.id).maybeSingle() : { data: null as any };
  const fComps = comps.filter((c: any) => c.template_code === 'F');
  return (
    <>
      <p className="mb-2 text-sm"><Link className="text-maroon underline" href="/admin/exams">← All examinations</Link></p>
      <h1 className="h2">{ex.name} · setup</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <form action={saveExam}>
        <input type="hidden" name="id" value={ex.id} />
        <div className="card"><div className="grid gap-x-4 md:grid-cols-2">
          <label className="lbl">Name<input className="input" name="name" defaultValue={ex.name} required /></label>
          <label className="lbl">Heading on report card (e.g. Term I)<input className="input" name="display_name" defaultValue={ex.display_name || ''} /></label>
          <label className="lbl">Academic Term field (e.g. Term - I)<input className="input" name="term_label" defaultValue={ex.term_label || ''} /></label>
          <label className="lbl">Status<select className="input" name="status" defaultValue={ex.status}><option value="DRAFT">Draft</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></label>
          <label className="lbl">Result status rule<select className="input" name="result_rule_id" defaultValue={ex.result_rule_id || ''}><option value="">Manual</option>{(rules || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          {ar && <label className="lbl">Annual method<select className="input" name="annual_method" defaultValue={ar.method}><option value="WEIGHTED">Weighted average</option><option value="SUM">Sum of marks</option></select></label>}</div></div>
        {ex.type !== 'ANNUAL' && (tpls || []).map((t: any) => { const cs = comps.filter((c: any) => c.template_code === t.code); return (
          <div className="card" key={t.code}><h2 className="h3">{t.name}{t.code === 'F' ? ' (default maximum; subject-wise below)' : ''}</h2>
            <div className="tw"><table className="t"><thead><tr><th>Code</th><th>Column heading</th><th>Max marks</th></tr></thead><tbody>
              {cs.map((c: any) => <tr key={c.id}><td>{c.code}</td><td><input className="input !min-h-[36px]" name={`comp_${c.id}_label`} defaultValue={c.label} required /></td><td><input className="input !min-h-[36px] !w-24" type="number" step="0.5" min={0} name={`comp_${c.id}_max`} defaultValue={Number(c.max_marks)} required /></td></tr>)}</tbody></table></div>
            <p className="muted mt-2">Total: {cs.reduce((a: number, c: any) => a + Number(c.max_marks), 0)}</p></div>); })}
        {ex.type !== 'ANNUAL' && fComps.length > 0 && (
          <div className="card"><h2 className="h3">Class XI–XII subject-wise maximum marks</h2><p className="muted mb-2">For example 30 + 70 for practical subjects and 20 + 80 for others.</p>
            <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Subject</th>{fComps.map((c: any) => <th key={c.id}>{c.label}</th>)}</tr></thead><tbody>
              {subs.map((s: any) => <tr key={s.id}><td>{s.class_id === 11 ? 'XI' : 'XII'}</td><td>{s.display_label} {s.subjects?.code ? `(${s.subjects.code})` : ''}</td>
                {fComps.map((c: any) => { const l = lims.find((x: any) => x.class_subject_id === s.id && x.component_id === c.id); return <td key={c.id}><input className="input !min-h-[36px] !w-20" type="number" step="0.5" min={0} name={`lim_${s.id}_${c.id}`} defaultValue={l?.max_marks != null ? Number(l.max_marks) : Number(c.max_marks)} /></td>; })}</tr>)}</tbody></table></div></div>)}
        <button className="btn">Save</button>
      </form>
    </>
  );
}
