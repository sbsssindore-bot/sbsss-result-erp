'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const back = (m: string, err = false, to = '/admin/exams'): never => redirect(`${to}${to.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);
const NEXT = (e: any) => e?.digest?.startsWith?.('NEXT_REDIRECT');

export async function createExam(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const name = String(fd.get('name') || '').trim(), label = String(fd.get('label') || '').trim(), type = String(fd.get('type') || 'TERM');
  if (!name || !session) return back('Enter an examination name.', true);
  try {
    if (type === 'ANNUAL') {
      const sources = fd.getAll('src').map(String).map((id) => ({ exam_id: id, weight: Number(fd.get(`w_${id}`)) || 1 }));
      const { error } = await sb.rpc('create_annual_examination', { p_session: session.id, p_name: name, p_term_label: label, p_method: String(fd.get('method') || 'WEIGHTED'), p_sources: sources });
      if (error) return back(friendlyError(error), true);
    } else {
      const from = String(fd.get('from') || '');
      if (!from) return back('Choose an examination to copy the structure from.', true);
      const { error } = await sb.rpc('clone_examination', { p_source: from, p_name: name, p_term_label: label, p_rename: fd.get('rename') === 'on' });
      if (error) return back(friendlyError(error), true);
    }
    revalidatePath('/admin/exams');
    return back(`${name} created. Students, subjects and teacher assignments are reused automatically.`);
  } catch (e) { if (NEXT(e)) throw e; return back(friendlyError(e), true); }
}

export async function saveExam(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id'));
  const here = `/admin/exams/${id}`;
  try {
    const { error } = await sb.from('examinations').update({
      name: String(fd.get('name') || '').trim(), display_name: String(fd.get('display_name') || '').trim() || null, term_label: String(fd.get('term_label') || '').trim() || null,
      status: ['DRAFT', 'OPEN', 'CLOSED'].includes(String(fd.get('status'))) ? String(fd.get('status')) : 'OPEN', result_rule_id: String(fd.get('result_rule_id') || '') || null,
    }).eq('id', id);
    if (error) return back(friendlyError(error), true, here);
    // components: comp_<id>_label / comp_<id>_max
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^comp_([0-9a-f-]{36})_label$/);
      if (!m) continue;
      const max = Number(fd.get(`comp_${m[1]}_max`));
      if (!(max >= 0)) return back('Maximum marks must be zero or more.', true, here);
      const r = await sb.from('exam_components').update({ label: String(v).trim(), max_marks: max }).eq('id', m[1]);
      if (r.error) return back(friendlyError(r.error), true, here);
    }
    // per-subject limits (XI–XII): lim_<classSubjectId>_<componentId>
    const lims: any[] = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^lim_([0-9a-f-]{36})_([0-9a-f-]{36})$/);
      if (m && String(v).trim() !== '') lims.push({ class_subject_id: m[1], component_id: m[2], max_marks: Number(v), is_applicable: true });
    }
    if (lims.some((l) => !(l.max_marks >= 0))) return back('Subject maximum marks must be zero or more.', true, here);
    if (lims.length) { const r = await sb.from('exam_component_limits').upsert(lims, { onConflict: 'class_subject_id,component_id' }); if (r.error) return back(friendlyError(r.error), true, here); }
    const ar = String(fd.get('annual_method') || '');
    if (ar) await sb.from('annual_rules').update({ method: ar }).eq('examination_id', id);
    revalidatePath('/admin/exams');
    return back('Saved.', false, here);
  } catch (e) { if (NEXT(e)) throw e; return back(friendlyError(e), true, here); }
}
