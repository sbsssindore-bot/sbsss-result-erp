/**
 * Teacher self-activation — pure logic. All database/Auth work goes through the `ActivationStore`
 * interface so it can be tested without Supabase. Runs on the server only.
 */
import { LOGIN_ID_RE } from './loginId';

export type TeacherRow = { id: string; employee_id: string; name: string; email: string | null; login_id: string | null; profile_id: string | null; status: string };
export type AuthUserInfo = { id: string; email: string | null; activated: boolean };

export interface ActivationStore {
  failuresSince(minutesAgo: number, by: { ip?: string; employeeId?: string }): Promise<number>;
  recordAttempt(a: { employeeId: string; ip: string; ok: boolean }): Promise<void>;
  /** Must THROW on a database error (never return null for "error"). */
  findTeacher(employeeId: string): Promise<TeacherRow | null>;
  getAuthUser(id: string): Promise<AuthUserInfo | null>;
  findAuthUserByEmail(email: string): Promise<AuthUserInfo | null>;
  getProfileRole(id: string): Promise<string | null>;
  createAuthUser(email: string, password: string, fullName: string): Promise<{ id?: string; error?: string }>;
  updateAuthUser(id: string, patch: { email: string; password: string }): Promise<string | null>;
  deleteAuthUser(id: string): Promise<void>;
  upsertTeacherProfile(id: string, email: string, fullName: string): Promise<string | null>;
  linkTeacher(teacherId: string, profileId: string, loginId: string): Promise<string | null>;
}

export type ActivationResult = { ok: boolean; code: 'ACTIVATED' | 'ALREADY' | 'NOT_FOUND' | 'EMAIL_MISMATCH' | 'INVALID' | 'INACTIVE' | 'ADMIN_EMAIL' | 'RATE_LIMIT' | 'WEAK' | 'ERROR'; message: string; loginId?: string };

export const MSG_NOT_FOUND = 'Teacher ID not found.';
export const MSG_EMAIL = 'Registered email does not match this Teacher ID.';
export const MSG_INACTIVE = 'This teacher account is inactive.';
export const MSG_ALREADY = 'This teacher account is already activated. Please use Teacher Login.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const IP_LIMIT = 20, ID_LIMIT = 8, WINDOW_MIN = 15;

/** Canonical form for comparing IDs/emails: Unicode-normalised (full-width and look-alike compatibility forms), with every
 *  whitespace, control, zero-width and other invisible/format character removed, then lower-cased. */
const INVISIBLE = /[\p{Z}\p{Cc}\p{Cf}⁠﻿]/gu;
const canon = (s: unknown) => String(s ?? '').normalize('NFKC').replace(INVISIBLE, '').toLowerCase();
export const normId = canon;
export const normEmail = canon;

/** Safe description for SERVER logs only: never the full address, only shape + where the two values first differ. */
export function describeMismatch(stored: unknown, submitted: string) {
  const a = String(stored ?? ''), b = submitted;
  const mask = (e: string) => (e.length <= 3 ? '***' : e[0] + '***' + e.slice(e.indexOf('@') > 0 ? e.indexOf('@') : e.length - 1));
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return {
    storedNull: stored == null, storedRawLength: a.length, storedCanonLength: canon(a).length, submittedLength: b.length,
    storedNonAscii: [...a].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 33).length,
    storedMasked: mask(canon(a)), submittedMasked: mask(b), firstDifferenceAtIndex: canon(a) === b ? -1 : i,
    sameDomain: canon(a).split('@')[1] === b.split('@')[1], sameLocalPartLength: canon(a).split('@')[0]?.length === b.split('@')[0]?.length,
  };
}

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

export async function activateTeacher(store: ActivationStore, input: { employeeId: string; email: string; password: string; ip: string }): Promise<ActivationResult> {
  const employeeId = normId(input.employeeId);
  const email = normEmail(input.email);
  const password = String(input.password || '');
  const ip = input.ip || 'unknown';
  const err = (message: string): ActivationResult => ({ ok: false, code: 'ERROR', message });
  if (!LOGIN_ID_RE.test(employeeId)) return { ok: false, code: 'NOT_FOUND', message: MSG_NOT_FOUND };
  if (!EMAIL_RE.test(email)) return { ok: false, code: 'INVALID', message: 'Enter a valid email address.' };
  const weak = passwordProblem(password);
  if (weak) return { ok: false, code: 'WEAK', message: weak };

  try {
    if ((await store.failuresSince(WINDOW_MIN, { ip })) >= IP_LIMIT || (await store.failuresSince(WINDOW_MIN, { employeeId })) >= ID_LIMIT)
      return { ok: false, code: 'RATE_LIMIT', message: 'Too many attempts. Please wait 15 minutes and try again.' };
  } catch { return err('Activation is not ready yet (database migration 0006 has not been run). Please contact the administrator.'); }

  const fail = async (code: ActivationResult['code'], message: string): Promise<ActivationResult> => { await store.recordAttempt({ employeeId, ip, ok: false }).catch(() => {}); return { ok: false, code, message }; };

  let t: TeacherRow | null;
  try { t = await store.findTeacher(employeeId); } catch { return err('Could not read teacher records right now. Please try again, or contact the administrator.'); }
  if (!t) return fail('NOT_FOUND', MSG_NOT_FOUND);
  if (!t.email || normEmail(t.email) !== email) {
    // Server-side only (Vercel function logs). Nothing here is sent to the browser.
    console.error('[teacher-activation] email mismatch for', JSON.stringify({ employeeId, matchedRow: t.employee_id.trim(), ...describeMismatch(t.email, email) }));
    return fail('EMAIL_MISMATCH', MSG_EMAIL);
  }
  if (t.status !== 'ACTIVE') return { ok: false, code: 'INACTIVE', message: MSG_INACTIVE };

  const loginId = (t.login_id || '').trim() || t.employee_id.trim();
  const teacherEmail = normEmail(t.email);
  try {
    // 1) Is there already an Auth user for this teacher? (linked profile first, then by email)
    let u: AuthUserInfo | null = t.profile_id ? await store.getAuthUser(t.profile_id) : null;
    if (!u) u = await store.findAuthUserByEmail(teacherEmail);

    if (u) {
      const role = await store.getProfileRole(u.id);
      if (role && role !== 'TEACHER') return fail('ADMIN_EMAIL', 'This email belongs to an administrator account. Please contact the administrator.');
      if (u.activated) return { ok: false, code: 'ALREADY', message: MSG_ALREADY, loginId };
      // Existing account whose activation never completed: keep the same user id, set the password the teacher chose.
      const uerr = await store.updateAuthUser(u.id, { email: teacherEmail, password });
      if (uerr) return err(/password/i.test(uerr) ? 'That password was not accepted. Choose a longer, less common password.' : 'Could not set the password. Please try again, or contact the administrator.');
      const perr = (await store.upsertTeacherProfile(u.id, teacherEmail, t.name)) || (await store.linkTeacher(t.id, u.id, loginId));
      if (perr) return err('The password was set but the account could not be linked. Please contact the administrator.');
      await store.recordAttempt({ employeeId, ip, ok: true }).catch(() => {});
      return { ok: true, code: 'ACTIVATED', loginId, message: 'Your account is activated.' };
    }

    // 2) No Auth user yet: create one, then profile + link; roll back on failure.
    const created = await store.createAuthUser(teacherEmail, password, t.name);
    if (!created.id) return err(created.error && /password/i.test(created.error) ? 'That password was not accepted. Choose a longer, less common password.' : 'Could not create the account right now. Please try again, or contact the administrator.');
    const perr = (await store.upsertTeacherProfile(created.id, teacherEmail, t.name)) || (await store.linkTeacher(t.id, created.id, loginId));
    if (perr) { await store.deleteAuthUser(created.id); return err('Could not finish activation. Nothing was changed — please try again or contact the administrator.'); }
    await store.recordAttempt({ employeeId, ip, ok: true }).catch(() => {});
    return { ok: true, code: 'ACTIVATED', loginId, message: 'Your account is activated.' };
  } catch { return err('Something went wrong while activating. Please try again, or contact the administrator.'); }
}

/** Supabase implementation (service-role client, server only). */
export function supabaseStore(admin: any): ActivationStore {
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  const info = (u: any): AuthUserInfo => ({ id: u.id, email: u.email ?? null, activated: !!u.user_metadata?.teacher_activated_at });
  return {
    async failuresSince(min, by) {
      const since = new Date(Date.now() - min * 60000).toISOString();
      let q = admin.from('teacher_activation_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('created_at', since);
      q = by.ip ? q.eq('ip', by.ip) : q.ilike('employee_id', esc(by.employeeId || ''));
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async recordAttempt(a) { await admin.from('teacher_activation_attempts').insert({ employee_id: a.employeeId, ip: a.ip, ok: a.ok }); },
    async findTeacher(employeeId) {
      // Match on employee_id OR login_id. Candidates are fetched loosely (stored values may carry stray spaces/case),
      // then compared exactly after canonicalising. employeeId has already passed LOGIN_ID_RE (letters/digits . _ - only).
      const pat = `*${employeeId}*`; // PostgREST wildcard; "_" may over-match, which is fine because the exact check follows
      const { data, error } = await admin.from('teachers').select('id,employee_id,name,email,login_id,profile_id,status').or(`employee_id.ilike.${pat},login_id.ilike.${pat}`).limit(50);
      if (error) throw new Error(error.message);
      const rows = data || [];
      const byEmp = rows.filter((r: any) => normId(r.employee_id) === employeeId);
      if (byEmp.length === 1) return byEmp[0];
      if (byEmp.length > 1) return null;
      const byLogin = rows.filter((r: any) => normId(r.login_id) === employeeId);
      return byLogin.length === 1 ? byLogin[0] : null;
    },
    async getAuthUser(id) { const { data, error } = await admin.auth.admin.getUserById(id); return error || !data?.user ? null : info(data.user); },
    async findAuthUserByEmail(email) {
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        const u = (data?.users || []).find((x: any) => normEmail(x.email) === email);
        if (u) return info(u);
        if (!data?.users || data.users.length < 1000) break;
      }
      return null;
    },
    async getProfileRole(id) { const { data } = await admin.from('profiles').select('role').eq('id', id).maybeSingle(); return data?.role ?? null; },
    async createAuthUser(email, password, fullName) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, teacher_activated_at: new Date().toISOString() } });
      return error ? { error: error.message } : { id: data.user.id };
    },
    async updateAuthUser(id, patch) {
      const { data: cur } = await admin.auth.admin.getUserById(id);
      const meta = { ...(cur?.user?.user_metadata || {}), teacher_activated_at: new Date().toISOString() };
      const { error } = await admin.auth.admin.updateUserById(id, { email: patch.email, password: patch.password, email_confirm: true, user_metadata: meta });
      return error ? error.message : null;
    },
    async deleteAuthUser(id) { await admin.auth.admin.deleteUser(id); },
    async upsertTeacherProfile(id, email, fullName) {
      const { error } = await admin.from('profiles').upsert({ id, email, full_name: fullName, role: 'TEACHER', status: 'ACTIVE' }, { onConflict: 'id' });
      return error ? error.message : null;
    },
    async linkTeacher(teacherId, profileId, loginId) {
      const { error } = await admin.from('teachers').update({ profile_id: profileId, login_id: loginId }).eq('id', teacherId).or(`profile_id.is.null,profile_id.eq.${profileId}`);
      return error ? error.message : null;
    },
  };
}
