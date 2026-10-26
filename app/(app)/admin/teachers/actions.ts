
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase/admin';

const T = z.object({
  employee_id: z.string().trim().min(1, 'Employee ID is required.').max(40),
  name: z.string().trim().min(1, 'Teacher name is required.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  login_id: z.string().trim()
    .regex(
      /^[A-Za-z0-9._-]{3,40}$/,
      'Login ID: 3–40 letters, digits, dot, dash or underscore, no spaces.'
    )
    .optional()
    .or(z.literal('')),
});

const t = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};

const go = (m: string, err = false): never =>
  redirect(
    `/admin/teachers?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`
  );

export async function saveTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = t(fd, 'id');
  const p = T.safeParse(Object.fromEntries(fd));

  if (!p.success) {
    return redirect(
      `/admin/teachers?${id ? 'edit=' + id + '&' : 'add=1&'}err=${encodeURIComponent(p.error.issues[0].message)}`
    );
  }

  const row = {
    ...p.data,
    login_id: p.data.login_id || null,
    mobile: t(fd, 'mobile'),
    designation: t(fd, 'designation'),
    department: t(fd, 'department'),
  };

  const { error } = id
    ? await sb.from('teachers').update(row).eq('id', id)
    : await sb.from('teachers').insert(row);

  if (error) {
    return redirect(
      `/admin/teachers?${id ? 'edit=' + id + '&' : 'add=1&'}err=${encodeURIComponent(friendlyError(error))}`
    );
  }

  revalidatePath('/admin/teachers');
  return go(id ? 'Teacher updated.' : 'Teacher added successfully.');
}

/** Admin-only password reset; no email service is required. */
export async function resetTeacherPassword(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get('id') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  const confirmPassword = String(fd.get('confirm_password') ?? '');
  if (!id) return go('Select a teacher account.', true);
  if (password.length < 8) return redirect(`/admin/teachers?reset=${encodeURIComponent(id)}&err=${encodeURIComponent('Password must be at least 8 characters.')}`);
  if (password !== confirmPassword) return redirect(`/admin/teachers?reset=${encodeURIComponent(id)}&err=${encodeURIComponent('Passwords do not match.')}`);
  const admin = supabaseAdmin();
  const { data: teacher, error: teacherError } = await admin.from('teachers').select('id,name,email,profile_id').eq('id', id).maybeSingle();
  if (teacherError || !teacher) return go('Teacher record was not found.', true);
  if (!teacher.profile_id || !teacher.email) return go('This teacher has not activated their account yet. Ask them to use Teacher Activation first.', true);
  const { error } = await admin.auth.admin.updateUserById(teacher.profile_id, { password });
  if (error) return redirect(`/admin/teachers?reset=${encodeURIComponent(id)}&err=${encodeURIComponent(error.message)}`);
  revalidatePath('/admin/teachers');
  return go(`Password reset successfully for ${teacher.name}. They can now sign in with their registered email and the new password.`);
}

export async function toggleTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id'));
  const to = String(fd.get('to')) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

  const { error } = await sb
    .from('teachers')
    .update({ status: to })
    .eq('id', id);

  revalidatePath('/admin/teachers');

  return error
    ? go(friendlyError(error), true)
    : go(to === 'ACTIVE' ? 'Teacher activated.' : 'Teacher deactivated.');
}

