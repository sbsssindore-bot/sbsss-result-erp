'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCtx } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const Input = z.object({
  examId: z.string().uuid(), csId: z.string().uuid(), subId: z.string().uuid(), submit: z.boolean(),
  rows: z.array(z.object({ e: z.string().uuid(), c: z.string().uuid(), v: z.number().min(0).max(1000).nullable(), ab: z.boolean() })).max(3000),
});

export async function saveMarks(raw: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Some values are not valid. Check the highlighted cells.' };
  const i = parsed.data;
  const { sb, isAdmin, teacher } = await requireCtx();
  try {
    // Server-side authorization: hiding a button is not enough.
    // Non-admin teachers may edit only the exact class/subject assigned to them.
    if (!isAdmin) {
      if (!teacher) return { ok: false, error: 'Your login is not linked to a teacher record.' };
      const { data: assignment, error: assignmentError } = await sb
        .from('teacher_assignments')
        .select('id')
        .eq('teacher_id', teacher.id)
        .eq('class_section_id', i.csId)
        .eq('class_subject_id', i.subId)
        .eq('role', 'SUBJECT')
        .limit(1)
        .maybeSingle();
      if (assignmentError) return { ok: false, error: friendlyError(assignmentError) };
      if (!assignment) return { ok: false, error: 'You are not assigned to this class and subject.' };
    }

    const [{ data: exam, error: examError }, { data: subject, error: subjectError }, { data: section, error: sectionError }] = await Promise.all([
      sb.from('examinations').select('id,session_id').eq('id', i.examId).maybeSingle(),
      sb.from('class_subjects').select('id,session_id,class_id,kind,status').eq('id', i.subId).maybeSingle(),
      sb.from('class_sections').select('id,session_id,class_id,status').eq('id', i.csId).maybeSingle(),
    ]);
    if (examError || subjectError || sectionError) return { ok: false, error: friendlyError(examError || subjectError || sectionError) };
    if (!exam || !subject || !section || subject.session_id !== exam.session_id || section.session_id !== exam.session_id ||
        subject.class_id !== section.class_id || subject.kind !== 'MARKS' || subject.status !== 'ACTIVE' || section.status !== 'ACTIVE') {
      return { ok: false, error: 'The selected examination, class, or subject is not valid.' };
    }

    // Prevent forged requests from writing marks for enrollments outside this section.
    const enrollmentIds = [...new Set(i.rows.map((r) => r.e))];
    if (enrollmentIds.length) {
      const { data: enrollments, error: enrollmentError } = await sb
        .from('student_class_enrollments')
        .select('id')
        .eq('class_section_id', i.csId)
        .eq('status', 'ACTIVE')
        .in('id', enrollmentIds);
      if (enrollmentError) return { ok: false, error: friendlyError(enrollmentError) };
      const allowed = new Set((enrollments || []).map((e: any) => e.id));
      if (enrollmentIds.some((id) => !allowed.has(id))) {
        return { ok: false, error: 'One or more students do not belong to this class section.' };
      }
    }

    let { data: batch, error: batchError } = await sb.from('mark_batches').select('*')
      .eq('examination_id', i.examId).eq('class_section_id', i.csId).eq('class_subject_id', i.subId).maybeSingle();
    if (batchError) return { ok: false, error: friendlyError(batchError) };
    if (!batch) {
      const ins = await sb.from('mark_batches').insert({ examination_id: i.examId, class_section_id: i.csId, class_subject_id: i.subId }).select().single();
      if (ins.error) return { ok: false, error: friendlyError(ins.error) };
      batch = ins.data;
    }
    if (batch.status === 'LOCKED') return { ok: false, error: 'Exam is locked. Only the administrator can unlock it.' };
    if (!isAdmin && ['SUBMITTED', 'VERIFIED'].includes(batch.status)) {
      return { ok: false, error: 'These marks have been submitted. Ask the administrator to return them for correction.' };
    }

    const rows = i.rows.map((r) => ({
      batch_id: batch.id, enrollment_id: r.e, examination_id: i.examId, class_subject_id: i.subId,
      component_id: r.c, value: r.ab ? null : r.v, is_absent: r.ab,
    }));
    if (rows.length) {
      const { error } = await sb.from('marks').upsert(rows, { onConflict: 'enrollment_id,examination_id,class_subject_id,component_id' });
      if (error) return { ok: false, error: friendlyError(error) };
    }
    if (i.submit && ['DRAFT', 'NONE'].includes(batch.status)) {
      const { error } = await sb.from('mark_batches').update({ status: 'SUBMITTED' }).eq('id', batch.id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    revalidatePath('/marks');
    revalidatePath('/teacher');
    revalidatePath('/admin/review');
    return { ok: true, message: i.submit ? (isAdmin ? 'Saved and marked as submitted.' : 'Marks submitted.') : 'Draft saved.' };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
