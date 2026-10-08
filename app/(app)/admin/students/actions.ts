'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const S = z.object({
  scholar_number: z.string().trim().min(1, 'Scholar number is required.').max(40),
  name: z.string().trim().min(1, 'Student name is required.').max(120),
  class_section_id: z.string().uuid('Choose a class section.'),
  roll_number: z.coerce.number().int().min(1, 'Enter a roll number.').max(999),
});
const t = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v === '' ? null : v; };

export async function saveStudent(fd: FormData) {
  const { sb } = await requireAdmin();
  const enrId = t(fd, 'enrollment_id');
  const back = enrId ? `/admin/students/${enrId}` : '/admin/students/new';
  const bad = (m: string): never => redirect(`${back}?err=${encodeURIComponent(m)}`);
  const parsed = S.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return bad(parsed.error.issues[0].message);
  const v = parsed.data;
  const gender = t(fd, 'gender');
  const stu = { scholar_number: v.scholar_number, name: v.name, father_name: t(fd, 'father_name'), mother_name: t(fd, 'mother_name'), dob: t(fd, 'dob'), gender: gender && ['M', 'F', 'O'].includes(gender) ? gender : null, admission_number: t(fd, 'admission_number'), mobile: t(fd, 'mobile'), address: t(fd, 'address') };
  try {
    const { data: cs } = await sb.from('class_sections').select('id,session_id,class_id').eq('id', v.class_section_id).single();
    let studentId = t(fd, 'student_id');
    if (studentId) { const { error } = await sb.from('students').update(stu).eq('id', studentId); if (error) return bad(friendlyError(error)); }
    else { const { data, error } = await sb.from('students').insert(stu).select('id').single(); if (error) return bad(friendlyError(error)); studentId = data.id; }
    let id = enrId;
    if (id) {
      const { error } = await sb.from('student_class_enrollments').update({ class_section_id: v.class_section_id, roll_number: v.roll_number, status: t(fd, 'status') || 'ACTIVE' }).eq('id', id);
      if (error) return bad(friendlyError(error));
    } else {
      const { data, error } = await sb.from('student_class_enrollments').insert({ student_id: studentId, session_id: cs!.session_id, class_section_id: v.class_section_id, roll_number: v.roll_number }).select('id').single();
      if (error) return bad(friendlyError(error));
      id = data.id;
    }
    if (cs!.class_id >= 11) {
      const chosen: { enrollment_id: string; subject_group_id: string; class_subject_id: string }[] = [];
      for (const [k, val] of fd.entries()) if (k.startsWith('slot_') && val) chosen.push({ enrollment_id: id!, subject_group_id: k.slice(5), class_subject_id: String(val) });
      await sb.from('student_subject_choices').delete().eq('enrollment_id', id!);
      if (chosen.length) { const { error } = await sb.from('student_subject_choices').insert(chosen); if (error) return bad(friendlyError(error)); }
    }
    revalidatePath('/admin/students');
    redirect(`/admin/students/${id}?msg=${encodeURIComponent('Student saved.')}`);
  } catch (e: any) {
    if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    return bad(friendlyError(e));
  }
}

export async function deactivateEnrollment(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id'));
  const to = String(fd.get('to')) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const { error } = await sb.from('student_class_enrollments').update({ status: to }).eq('id', id);
  revalidatePath('/admin/students');
  redirect(`/admin/students?${error ? 'err=' + encodeURIComponent(friendlyError(error)) : 'msg=' + encodeURIComponent(to === 'ACTIVE' ? 'Student re-activated.' : 'Student deactivated. History is kept.')}`);
}
