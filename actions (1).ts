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
  login_id: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, 'Login ID: 3–40 letters, digits, dot, dash or underscore, no spaces.').optional().or(z.literal('')),
});
const t = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v === '' ? null : v; };
const site = () => siteUrlFrom(process.env, (h) => headers().get(h));
const redirectUrl = () => callbackUrl(site());
const go = (m: string, err = false): never => redirect(`/admin/teachers?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);

export async function saveTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = t(fd, 'id');
  const p = T.safeParse(Object.fromEntries(fd));
  if (!p.success) return redirect(`/admin/teachers?${id ? 'edit=' + id + '&' : 'add=1&'}err=${encodeURIComponent(p.error.issues[0].message)}`);
  const row = { ...p.data, login_id: p.data.login_id || null, mobile: t(fd, 'mobile'), designation: t(fd, 'designation'), department: t(fd, 'department') };
  const { error } = id ? await sb.from('teachers').update(row).eq('id', id) : await sb.from('teachers').insert(row);
  revalidatePath('/admin/teachers');
  if (error) return redirect(`/admin/teachers?${id ? 'edit=' + id + '&' : 'add=1&'}err=${encodeURIComponent(friendlyError(error))}`);
  return go(id ? 'Teacher updated.' : 'Teacher added. Use “Send invite” so they can set a password.');
}

export async function toggleTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id')), to = String(fd.get('to')) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const { error } = await sb.from('teachers').update({ status: to }).eq('id', id);
  revalidatePath('/admin/teachers');
  return error ? go(friendlyError(error), true) : go(to === 'ACTIVE' ? 'Teacher activated.' : 'Teacher deactivated.');
}

export async function inviteTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const { data: tc } = await sb.from('teachers').select('id,name,email,profile_id').eq('id', String(fd.get('id'))).single();
  if (!tc?.email) return go('Add an email address for this teacher first.', true);
  if (tc.profile_id) return go(`${tc.name} already has a login. Use “Reset password” if needed.`, true);
  // go() calls redirect(), which works by THROWING NEXT_REDIRECT. It must never run inside a try/catch, otherwise the catch
  // swallows it and the page shows "NEXT_REDIRECT" instead of the real result. So: decide inside try, redirect outside.
  let failure: string | null = null, note = '';
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.auth.admin.inviteUserByEmail(tc.email, { redirectTo: redirectUrl(), data: { full_name: tc.name } });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) {
        // The login already exists in Supabase Auth (e.g. invited earlier but not accepted yet). Send a set-password link to the
        // same callback instead; it lands on /set-password exactly like an invitation.
        const { error: e2 } = await admin.auth.resetPasswordForEmail(tc.email, { redirectTo: redirectUrl() });
        if (e2) failure = /rate limit|too many/i.test(e2.message) ? 'Supabase email limit reached. Wait about an hour, or set up SMTP in Supabase (Authentication → SMTP).' : e2.message;
        else note = ' (this email already had a login, so a set-password link was sent)';
      } else failure = /rate limit|too many/i.test(error.message) ? 'Supabase email limit reached. Wait about an hour, or set up SMTP in Supabase (Authentication → SMTP).' : error.message;
    }
  } catch (e: any) { failure = e?.message || 'Could not send the invitation.'; }
  if (failure) return go(failure, true);
  revalidatePath('/admin/teachers');
  return go(`Invitation sent to ${tc.email}${note}.`);
}

export async function resetTeacherPassword(fd: FormData) {
  const { sb } = await requireAdmin();
  const { data: tc } = await sb.from('teachers').select('name,email').eq('id', String(fd.get('id'))).single();
  if (!tc?.email) return go('This teacher has no email address.', true);
  // Admin-side client uses the implicit flow, so the emailed link works on the teacher's own device.
  const { error } = await supabaseAdmin().auth.resetPasswordForEmail(tc.email, { redirectTo: redirectUrl() });
  return error ? go(error.message, true) : go(`Password reset link sent to ${tc.email}.`);
}

/** Send an invitation to every active teacher who has an email but no login yet. */
export async function inviteAllTeachers() {
  const { sb } = await requireAdmin();
  const list = (await sb.from('teachers').select('id,name,email').is('profile_id', null).eq('status', 'ACTIVE').not('email', 'is', null).limit(200)).data || [];
  if (!list.length) return go('Every active teacher with an email already has a login.');
  const admin = supabaseAdmin(); let ok = 0; const fails: string[] = [];
  for (const t of list as any[]) {
    try {
      const { error } = await admin.auth.admin.inviteUserByEmail(t.email, { redirectTo: redirectUrl(), data: { full_name: t.name } });
      if (error) fails.push(`${t.name}: ${error.message}`); else ok++;
    } catch (e: any) { fails.push(`${t.name}: ${e.message}`); }
  }
  revalidatePath('/admin/teachers');
  const limited = fails.some((f) => /rate limit|too many/i.test(f));
  return go(`${ok} invitation(s) sent${fails.length ? `, ${fails.length} failed (first: ${fails[0]})` : ''}.${limited ? ' Supabase limits how many emails it sends per hour on the free built-in mail service; set up your own SMTP in Supabase (Authentication → SMTP) or send the rest later.' : ''}`, ok === 0 && fails.length > 0);
}
