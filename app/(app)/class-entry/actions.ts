'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCtx } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const Input = z.object({
  examId: z.string().uuid(), csId: z.string().uuid(), submit: z.boolean(),
  rows: z.array(z.object({
    e: z.string().uuid(), working: z.number().min(0).max(366).nullable(), present: z.number().min(0).max(366).nullable(),
    co: z.record(z.string().uuid(), z.string().max(3)), remarks: z.string().max(500), status: z.string().max(40).nullable(),
  })).max(500),
});

export async function saveClassEntry(raw: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Some values are not valid. Check attendance (0–366) and remarks length.' };
  const i = parsed.data;
  const { sb, isAdmin, teacher } = await requireCtx();
  try {
    // Class teachers can manage attendance/remarks; activity teachers can edit only assigned grade areas.
    let isGradeOnlyTeacher = false;
    let assignedAreaIds: string[] = [];
    if (!isAdmin) {
      if (!teacher) return { ok: false, error: 'Your login is not linked to a teacher record.' };
      const [{ data: classAssignment, error: classAssignmentError }, { data: gradeAssignments, error: gradeAssignmentError }] = await Promise.all([
        sb.from('teacher_assignments').select('id').eq('teacher_id', teacher.id).eq('class_section_id', i.csId).eq('role', 'CLASS').limit(1),
        sb.from('teacher_grade_assignments').select('area_id,class_id').eq('teacher_id', teacher.id).eq('session_id', (await sb.from('class_sections').select('session_id').eq('id', i.csId).maybeSingle()).data?.session_id || '').limit(1000)
      ]);
      if (classAssignmentError || gradeAssignmentError) return { ok: false, error: friendlyError(classAssignmentError || gradeAssignmentError) };
      const { data: targetSection } = await sb.from('class_sections').select('class_id').eq('id', i.csId).maybeSingle();
      assignedAreaIds = (gradeAssignments || []).filter((a: any) => a.class_id === targetSection?.class_id).map((a: any) => a.area_id);
      isGradeOnlyTeacher = !classAssignment?.length && assignedAreaIds.length > 0;
      if (!classAssignment?.length && !isGradeOnlyTeacher) return { ok: false, error: 'You are not assigned as class teacher or activity grade teacher for this class.' };
      if (isGradeOnlyTeacher && i.rows.some((r) => r.working != null || r.present != null || r.remarks.trim() !== '' || r.status != null)) {
        return { ok: false, error: 'Activity grade teachers can edit only their assigned activity grades.' };
      }
      if (isGradeOnlyTeacher && i.rows.some((r) => Object.keys(r.co).some((area) => !assignedAreaIds.includes(area)))) {
        return { ok: false, error: 'You can edit only the activities assigned to you.' };
      }
    }

    const [{ data: exam, error: examError }, { data: section, error: sectionError }] = await Promise.all([
      sb.from('examinations').select('id,session_id').eq('id', i.examId).maybeSingle(),
      sb.from('class_sections').select('id,session_id,class_id,status').eq('id', i.csId).maybeSingle(),
    ]);
    if (examError || sectionError) return { ok: false, error: friendlyError(examError || sectionError) };
    if (!exam || !section || exam.session_id !== section.session_id || section.status !== 'ACTIVE') {
      return { ok: false, error: 'The selected examination or class is not valid.' };
    }

    const enrollmentIds = [...new Set(i.rows.map((r) => r.e))];
    if (enrollmentIds.length) {
      const { data: enrollments, error: enrollmentError } = await sb
        .from('student_class_enrollments').select('id')
        .eq('class_section_id', i.csId).eq('status', 'ACTIVE').in('id', enrollmentIds);
      if (enrollmentError) return { ok: false, error: friendlyError(enrollmentError) };
      const allowed = new Set((enrollments || []).map((e: any) => e.id));
      if (enrollmentIds.some((id) => !allowed.has(id))) {
        return { ok: false, error: 'One or more students do not belong to this class section.' };
      }
    }

    let { data: batch, error: batchError } = await sb.from('mark_batches').select('*')
      .eq('examination_id', i.examId).eq('class_section_id', i.csId).is('class_subject_id', null).maybeSingle();
    if (batchError) return { ok: false, error: friendlyError(batchError) };
    if (!batch) {
      const ins = await sb.from('mark_batches').insert({ examination_id: i.examId, class_section_id: i.csId }).select().single();
      if (ins.error) return { ok: false, error: friendlyError(ins.error) };
      batch = ins.data;
    }
    if (batch.status === 'LOCKED') return { ok: false, error: 'This class entry is locked. Only the administrator can unlock it.' };
    if (!isAdmin && ['SUBMITTED', 'VERIFIED'].includes(batch.status)) {
      return { ok: false, error: 'This entry has been submitted. Ask the administrator to return it for correction.' };
    }
    const base = { batch_id: batch.id, examination_id: i.examId };

    const att = isGradeOnlyTeacher ? [] : i.rows.filter((r) => r.working != null || r.present != null).map((r) => ({ ...base, enrollment_id: r.e, working_days: r.working, present_days: r.present }));
    if (att.length) { const { error } = await sb.from('attendance').upsert(att, { onConflict: 'enrollment_id,examination_id' }); if (error) return { ok: false, error: friendlyError(error) }; }

    const { data: areaRows, error: areaError } = await sb.from('co_scholastic_areas').select('id').eq('session_id', section.session_id).eq('class_id', section.class_id);
    if (areaError) return { ok: false, error: friendlyError(areaError) };
    const allowedAreas = new Set((areaRows || []).map((a: any) => a.id));
    if (i.rows.some((r) => Object.keys(r.co).some((area) => !allowedAreas.has(area)))) {
      return { ok: false, error: 'One or more grade activities do not belong to this class.' };
    }

    const co: any[] = [], coDel: { e: string; a: string }[] = [];
    for (const r of i.rows) for (const [area, g] of Object.entries(r.co)) { if (isGradeOnlyTeacher && !assignedAreaIds.includes(area)) continue; if (g) co.push({ ...base, enrollment_id: r.e, area_id: area, grade: g }); else if (!isGradeOnlyTeacher || assignedAreaIds.includes(area)) coDel.push({ e: r.e, a: area }); }
    if (co.length) { const { error } = await sb.from('co_scholastic_marks').upsert(co, { onConflict: 'enrollment_id,examination_id,area_id' }); if (error) return { ok: false, error: friendlyError(error) }; }
    for (const d of coDel) {
      const { error } = await sb.from('co_scholastic_marks').delete().eq('enrollment_id', d.e).eq('examination_id', i.examId).eq('area_id', d.a);
      if (error) return { ok: false, error: friendlyError(error) };
    }

    const rem = isGradeOnlyTeacher ? [] : i.rows.map((r) => ({ ...base, enrollment_id: r.e, remarks: r.remarks || null, ...(isAdmin ? { result_status: r.status || null } : {}) }));
    if (rem.length) { const { error } = await sb.from('report_remarks').upsert(rem, { onConflict: 'enrollment_id,examination_id' }); if (error) return { ok: false, error: friendlyError(error) }; }

    if (i.submit && ['DRAFT', 'NONE'].includes(batch.status)) {
      const { error } = await sb.from('mark_batches').update({ status: 'SUBMITTED' }).eq('id', batch.id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    revalidatePath('/class-entry');
    revalidatePath('/teacher');
    revalidatePath('/admin/review');
    return { ok: true, message: i.submit ? 'Submitted.' : 'Saved.' };
  } catch (e) { return { ok: false, error: friendlyError(e) }; }
}
