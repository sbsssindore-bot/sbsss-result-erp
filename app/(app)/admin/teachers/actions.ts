
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { callbackUrl, siteUrlFrom } from '@/lib/siteUrl';

const T = z.object({
  employee_id: z.string().trim().min(1, 'Employee ID is required.').max(40),
  name: z.string().trim().min(1, 'Teacher name is required.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  login_id: z.string().trim()
    .regex(/^[A-Za-z0-9._-]{3,40}$/, 'Login ID: 3–40 letters, digits, dot, dash or underscore, no spaces.')
    .optional().or(z.literal('')),
});

const t = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};

const site = () => siteUrlFrom(process.env, (h) => headers().get(h));
const redirectUrl = () => callbackUrl(site());

const go = (m: string, err = false): never =>
  redirect(`/admin/teachers?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);

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

  revalidatePath('/admin/teachers');

  if (error) {
    return redirect(
      `/admin/teachers?${id ? 'edit=' + id + '&' : 'add=1&'}err=${encodeURIComponent(friendlyError(error))}`
    );
  }

  return go(id ? 'Teacher updated.' : 'Teacher added. Use “Send invite” so they can set a password.');
}

export async function toggleTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id'));
  const to = String(fd.get('to')) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

  const { error } = await sb.from('teachers').update({ status: to }).eq('id', id);

  revalidatePath('/admin/teachers');

  return error
    ? go(friendlyError(error), true)
    : go(to === 'ACTIVE' ? 'Teacher activated.' : 'Teacher deactivated.');
}

export async function inviteTeacher(fd: FormData) {
  const { sb } = await requireAdmin();

  const { data: tc, error: lookupError } = await sb
    .from('teachers')
    .select('id,name,email,profile_id')
    .eq('id', String(fd.get('id')))
    .single();

  if (lookupError || !tc) {
    return go('Teacher record not found. Please refresh and try again.', true);
  }

  if (!tc.email) {
    return go('Add an email address for this teacher first.', true);
  }

  if (tc.profile_id) {
    return go(`${tc.name} already has a login. Use “Reset password” if needed.`, true);
  }

  let failure = '';

  try {
    const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(
      tc.email,
      {
        redirectTo: redirectUrl(),
        data: { full_name: tc.name },
      }
    );

    if (error) {
      failure = /already|registered/i.test(error.message)
        ? 'This email may already have an account. Use “Reset password” if needed.'
        : error.message;
    }
  } catch (e: unknown) {
    failure = e instanceof Error
      ? e.message
      : 'Could not send the invitation. Please try again.';
  }

  if (failure) {
    console.error('[inviteTeacher] failed', {
      teacherId: tc.id,
      reason: failure,
    });
    return go(failure, true);
  }

  revalidatePath('/admin/teachers');
  return go(`Invitation sent to ${tc.email}.`);
}

export async function resetTeacherPassword(fd: FormData) {
  const { sb } = await requireAdmin();

  const { data: tc } = await sb
    .from('teachers')
    .select('name,email')
    .eq('id', String(fd.get('id')))
    .single();

  if (!tc?.email) {
    return go('This teacher has no email address.', true);
  }

  const { error } = await supabaseAdmin().auth.resetPasswordForEmail(
    tc.email,
    { redirectTo: redirectUrl() }
  );

  return error
    ? go(error.message, true)
    : go(`Password reset link sent to ${tc.email}.`);
}

export async function inviteAllTeachers() {
  const { sb } = await requireAdmin();

  const { data, error } = await sb
    .from('teachers')
    .select('id,name,email')
    .is('profile_id', null)
    .eq('status', 'ACTIVE')
    .not('email', 'is', null)
    .limit(200);

  if (error) {
    return go('Could not load teachers: ' + friendlyError(error), true);
  }

  const list = (data || []).filter(
    (teacher) => typeof teacher.email === 'string' && teacher.email.trim() !== ''
  );

  if (!list.length) {
    return go('Every active teacher with an email already has a login.');
  }

  const admin = supabaseAdmin();
  let ok = 0;
  const fails: string[] = [];

  for (const teacher of list) {
    try {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        teacher.email!,
        {
          redirectTo: redirectUrl(),
          data: { full_name: teacher.name },
        }
      );

      if (inviteError) {
        fails.push(`${teacher.name}: ${inviteError.message}`);
      } else {
        ok++;
      }
    } catch (e: unknown) {
      fails.push(
        `${teacher.name}: ${e instanceof Error ? e.message : 'Unknown invitation error'}`
      );
    }
  }

  revalidatePath('/admin/teachers');

  const limited = fails.some((message) => /rate limit|too many/i.test(message));
  const result =
    `${ok} invitation(s) sent` +
    (fails.length ? `, ${fails.length} failed (first: ${fails[0]})` : '') +
    (limited
      ? '. Supabase email rate limit reached. Configure SMTP or send the remaining invitations later.'
      : '');

  return go(result, ok === 0 && fails.length > 0);
}

