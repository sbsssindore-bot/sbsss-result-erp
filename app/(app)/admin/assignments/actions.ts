'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { friendlyError, fetchAll } from '@/lib/db';
import { parseIds, planSubjectAssignments } from '@/lib/assignGroups';

const done = (teacher: string, m: string, err = false): never => redirect(`/admin/assignments?teacher=${teacher}&${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);

/** Subject teacher: many class sections × many subjects in one go. mode = skip | add | replace (when another teacher already has it). */
export async function assignSubjectTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const teacher = String(fd.get('teacher') || ''), mode = String(fd.get('mode') || 'skip');
  const csIds = parseIds(fd.getAll('cs')), names = fd.getAll('subj').map((s) => String(s).toLowerCase());
  if (!teacher || !session) return done(teacher, 'Choose a teacher.', true);
  if (!csIds.length || !names.length) return done(teacher, 'Select at least one class section and one subject.', true);
  try {
    const sections = await fetchAll((a, b) => sb.from('class_sections').select('id,class_id,label,section_id,stream_id').in('id', csIds).range(a, b));
    const subs = await fetchAll((a, b) => sb.from('class_subjects').select('id,class_id,stream_id,display_label,kind,subjects(name)').eq('session_id', session.id).eq('status', 'ACTIVE').eq('kind', 'MARKS').range(a, b));
    const existing = await fetchAll((a, b) => sb.from('teacher_assignments').select('id,teacher_id,class_section_id,class_subject_id').eq('session_id', session.id).eq('role', 'SUBJECT').in('class_section_id', csIds).range(a, b));
    const { add, removeIds, skippedMissing, dup, conflicts } = planSubjectAssignments({ sections: sections as any, subs: subs as any, existing: existing as any, names, teacher, mode, session: session.id });
    if (removeIds.length) { const { error } = await sb.from('teacher_assignments').delete().in('id', removeIds); if (error) return done(teacher, friendlyError(error), true); }
    if (add.length) { const { error } = await sb.from('teacher_assignments').insert(add); if (error) return done(teacher, friendlyError(error), true); }
    revalidatePath('/admin/assignments');
    const parts = [`${add.length} assignment(s) added`];
    if (dup) parts.push(`${dup} already existed`);
    if (skippedMissing) parts.push(`${skippedMissing} skipped (subject not offered in that class)`);
    if (conflicts && mode === 'skip') parts.push(`${conflicts} skipped (already assigned to another teacher; choose Replace or Add as additional)`);
    return done(teacher, parts.join(', ') + '.', add.length === 0 && !dup);
  } catch (e: any) { if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return done(teacher, friendlyError(e), true); }
}

/** Class teacher: one per class section. mode = skip | replace. */
export async function assignClassTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const teacher = String(fd.get('teacher') || ''), mode = String(fd.get('mode') || 'skip');
  const csIds = parseIds(fd.getAll('cs'));
  if (!teacher || !session) return done(teacher, 'Choose a teacher.', true);
  if (!csIds.length) return done(teacher, 'Select at least one class section.', true);
  try {
    const existing = await fetchAll((a, b) => sb.from('teacher_assignments').select('id,teacher_id,class_section_id').eq('session_id', session.id).eq('role', 'CLASS').in('class_section_id', csIds).range(a, b));
    const add: any[] = []; const removeIds: string[] = []; let dup = 0, conflicts = 0;
    for (const id of csIds) {
      const same = existing.filter((e: any) => e.class_section_id === id);
      if (same.some((e: any) => e.teacher_id === teacher)) { dup++; continue; }
      if (same.length) { conflicts++; if (mode !== 'replace') continue; same.forEach((e: any) => removeIds.push(e.id)); }
      add.push({ session_id: session.id, teacher_id: teacher, class_section_id: id, role: 'CLASS' });
    }
    if (removeIds.length) await sb.from('teacher_assignments').delete().in('id', removeIds);
    if (add.length) { const { error } = await sb.from('teacher_assignments').insert(add); if (error) return done(teacher, friendlyError(error), true); }
    revalidatePath('/admin/assignments');
    return done(teacher, `${add.length} class teacher assignment(s) added${dup ? `, ${dup} already existed` : ''}${conflicts && mode !== 'replace' ? `, ${conflicts} skipped (class already has a class teacher; choose Replace)` : ''}.`, add.length === 0 && !dup);
  } catch (e: any) { if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return done(teacher, friendlyError(e), true); }
}

export async function removeAssignment(fd: FormData) {
  const { sb } = await requireAdmin();
  const teacher = String(fd.get('teacher') || '');
  const ids = parseIds([String(fd.get('id') || '')]);
  const { error } = ids.length ? await sb.from('teacher_assignments').delete().in('id', ids) : { error: { message: 'Nothing to remove.' } as any };
  revalidatePath('/admin/assignments');
  return done(teacher, error ? friendlyError(error) : 'Assignment removed.', !!error);
}
