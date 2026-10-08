/**
 * Teacher self-activation — pure logic. All database/Auth work goes through the `ActivationStore`
 * interface so it can be tested without Supabase. Runs on the server only.
 */
import { LOGIN_ID_RE } from './loginId';

export type TeacherRow = { id: string; employee_id: string; name: string; email: string | null; login_id: string | null; profile_id: string | null; status: string };
export type ProfileRow = { id: string; role: string };

export interface ActivationStore {
  failuresSince(minutesAgo: number, by: { ip?: string; employeeId?: string }): Promise<number>;
  recordAttempt(a: { employeeId: string; ip: string; ok: boolean }): Promise<void>;
  findTeacher(employeeId: string): Promise<TeacherRow | null>;
  findProfileByEmail(email: string): Promise<ProfileRow | null>;
  createAuthUser(email: string, password: string, fullName: string): Promise<{ id?: string; exists?: boolean; error?: string }>;
  deleteAuthUser(id: string): Promise<void>;
  upsertTeacherProfile(id: string, email: string, fullName: string): Promise<string | null>;
  linkTeacher(teacherId: string, profileId: string, loginId: string): Promise<string | null>;
}

export type ActivationResult = { ok: boolean; code: 'ACTIVATED' | 'LINKED' | 'ALREADY' | 'INVALID' | 'INACTIVE' | 'ADMIN_EMAIL' | 'RATE_LIMIT' | 'WEAK' | 'ERROR'; message: string; loginId?: string };

export const MSG_MISMATCH = 'Teacher ID and registered email do not match our records. Check both and try again, or ask the administrator.';
export const MSG_ALREADY = 'This teacher account is already activated. Please use Teacher Login.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const IP_LIMIT = 20, ID_LIMIT = 6, WINDOW_MIN = 15;

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

export async function activateTeacher(store: ActivationStore, input: { employeeId: string; email: string; password: string; ip: string }): Promise<ActivationResult> {
  const employeeId = String(input.employeeId || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const ip = input.ip || 'unknown';
  if (!LOGIN_ID_RE.test(employeeId) || !EMAIL_RE.test(email)) return { ok: false, code: 'INVALID', message: MSG_MISMATCH };
  const weak = passwordProblem(password);
  if (weak) return { ok: false, code: 'WEAK', message: weak };

  if ((await store.failuresSince(WINDOW_MIN, { ip })) >= IP_LIMIT || (await store.failuresSince(WINDOW_MIN, { employeeId })) >= ID_LIMIT)
    return { ok: false, code: 'RATE_LIMIT', message: 'Too many attempts. Please wait 15 minutes and try again.' };

  const fail = async (code: ActivationResult['code'], message: string): Promise<ActivationResult> => { await store.recordAttempt({ employeeId, ip, ok: false }); return { ok: false, code, message }; };

  const t = await store.findTeacher(employeeId);
  // Same answer for "no such ID" and "wrong email" so IDs cannot be probed.
  if (!t || !t.email || t.email.trim().toLowerCase() !== email) return fail('INVALID', MSG_MISMATCH);
  if (t.status !== 'ACTIVE') return { ok: false, code: 'INACTIVE', message: 'This teacher record is inactive. Please contact the administrator.' };
  if (t.profile_id) return { ok: false, code: 'ALREADY', message: MSG_ALREADY, loginId: t.login_id || t.employee_id };

  const loginId = t.login_id || t.employee_id;

  // An Auth account with this email may already exist (e.g. a test account) — link it, never duplicate it, never touch its password.
  const existing = await store.findProfileByEmail(email);
  if (existing) {
    if (existing.role !== 'TEACHER') return fail('ADMIN_EMAIL', 'This email belongs to an administrator account. Please contact the administrator.');
    const err = await store.linkTeacher(t.id, existing.id, loginId);
    if (err) return { ok: false, code: 'ERROR', message: 'Could not link the account. Please contact the administrator.' };
    await store.recordAttempt({ employeeId, ip, ok: true });
    return { ok: true, code: 'LINKED', loginId, message: 'Your account already existed and is now linked. Sign in with your Login ID and your existing password (use "Forgot password" if you do not remember it).' };
  }

  const created = await store.createAuthUser(email, password, t.name);
  if (created.exists) return { ok: false, code: 'ALREADY', message: MSG_ALREADY, loginId };
  if (!created.id) return { ok: false, code: 'ERROR', message: 'Could not create the account right now. Please try again, or contact the administrator.' };

  const perr = (await store.upsertTeacherProfile(created.id, email, t.name)) || (await store.linkTeacher(t.id, created.id, loginId));
  if (perr) { await store.deleteAuthUser(created.id); return { ok: false, code: 'ERROR', message: 'Could not finish activation. Nothing was changed — please try again or contact the administrator.' }; }
  await store.recordAttempt({ employeeId, ip, ok: true });
  return { ok: true, code: 'ACTIVATED', loginId, message: 'Your account is activated.' };
}

/** Supabase implementation (service-role client, server only). */
export function supabaseStore(admin: any): ActivationStore {
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  return {
    async failuresSince(min, by) {
      const since = new Date(Date.now() - min * 60000).toISOString();
      let q = admin.from('teacher_activation_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('created_at', since);
      q = by.ip ? q.eq('ip', by.ip) : q.ilike('employee_id', esc(by.employeeId || ''));
      const { count, error } = await q;
      if (error) throw new Error('throttle-unavailable');
      return count || 0;
    },
    async recordAttempt(a) { await admin.from('teacher_activation_attempts').insert({ employee_id: a.employeeId, ip: a.ip, ok: a.ok }); },
    async findTeacher(employeeId) {
      const { data } = await admin.from('teachers').select('id,employee_id,name,email,login_id,profile_id,status').ilike('employee_id', esc(employeeId)).limit(2);
      return data && data.length === 1 ? data[0] : null;
    },
    async findProfileByEmail(email) {
      const { data } = await admin.from('profiles').select('id,role').ilike('email', esc(email)).limit(2);
      return data && data.length >= 1 ? data[0] : null;
    },
    async createAuthUser(email, password, fullName) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
      if (error) return /already|registered|exists/i.test(error.message) ? { exists: true } : { error: error.message };
      return { id: data.user.id };
    },
    async deleteAuthUser(id) { await admin.auth.admin.deleteUser(id); },
    async upsertTeacherProfile(id, email, fullName) {
      const { error } = await admin.from('profiles').upsert({ id, email, full_name: fullName, role: 'TEACHER', status: 'ACTIVE' }, { onConflict: 'id' });
      return error ? error.message : null;
    },
    async linkTeacher(teacherId, profileId, loginId) {
      const { error } = await admin.from('teachers').update({ profile_id: profileId, login_id: loginId }).eq('id', teacherId).is('profile_id', null);
      return error ? error.message : null;
    },
  };
}
