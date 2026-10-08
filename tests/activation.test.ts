import test from 'node:test';
import assert from 'node:assert/strict';
import { activateTeacher, MSG_ALREADY, MSG_EMAIL, MSG_INACTIVE, MSG_NOT_FOUND, passwordProblem, type ActivationStore, type AuthUserInfo, type TeacherRow } from '../lib/teacherActivation';
import { resolveLoginEmail } from '../lib/loginId';

type AU = { id: string; email: string; activated: boolean; password?: string };
function mk(teachers: TeacherRow[], users: AU[] = [], roles: Record<string, string> = {}) {
  const attempts: { employeeId: string; ip: string; ok: boolean }[] = []; let failLink = false; let n = 0;
  const info = (u?: AU): AuthUserInfo | null => (u ? { id: u.id, email: u.email, activated: u.activated } : null);
  const store: ActivationStore = {
    async failuresSince(_m, by) { return attempts.filter((a) => !a.ok && (by.ip ? a.ip === by.ip : a.employeeId.toLowerCase() === by.employeeId!.toLowerCase())).length; },
    async recordAttempt(a) { attempts.push(a); },
    async findTeacher(id) { return teachers.find((t) => t.employee_id.replace(/\s/g, '').toLowerCase() === id) || null; },
    async getAuthUser(id) { return info(users.find((u) => u.id === id)); },
    async findAuthUserByEmail(e) { return info(users.find((u) => u.email.toLowerCase() === e)); },
    async getProfileRole(id) { return roles[id] ?? null; },
    async createAuthUser(email, password) { if (users.some((u) => u.email === email)) return { error: 'exists' }; const u = { id: 'new' + ++n, email, activated: true, password }; users.push(u); return { id: u.id }; },
    async updateAuthUser(id, p) { const u = users.find((x) => x.id === id)!; u.email = p.email; u.password = p.password; u.activated = true; return null; },
    async deleteAuthUser(id) { const i = users.findIndex((u) => u.id === id); if (i >= 0) users.splice(i, 1); },
    async upsertTeacherProfile(id) { roles[id] = 'TEACHER'; return null; },
    async linkTeacher(tid, pid, login) { if (failLink) return 'boom'; const t = teachers.find((x) => x.id === tid)!; if (t.profile_id && t.profile_id !== pid) return 'taken'; t.profile_id = pid; t.login_id = login; return null; },
  };
  return { store, users, attempts, roles, setFailLink: (v: boolean) => { failLink = v; } };
}
const E = 'poonit11verma@gmail.com';
const T = (o: Partial<TeacherRow> = {}): TeacherRow => ({ id: 't1', employee_id: 'T010', name: 'Naina Verma', email: E, login_id: 'T010', profile_id: null, status: 'ACTIVE', ...o });
const run = (s: ActivationStore, o: any = {}) => activateTeacher(s, { employeeId: 'T010', email: E, password: 'Passw0rdX', ip: '1.1.1.1', ...o });

test('T010 + poonit11verma@gmail.com with NO auth user: creates user, TEACHER profile, links, login_id T010', async () => {
  const t = T(); const m = mk([t]); const r = await run(m.store);
  assert.equal(r.code, 'ACTIVATED'); assert.equal(r.loginId, 'T010'); assert.equal(m.users.length, 1); assert.equal(t.profile_id, m.users[0].id); assert.equal(m.roles[m.users[0].id], 'TEACHER');
});
test('T010 with EXISTING auth user + TEACHER profile (already linked): same user id, password updated, no duplicate', async () => {
  const t = T({ profile_id: 'old' }); const m = mk([t], [{ id: 'old', email: E, activated: false }], { old: 'TEACHER' });
  const r = await run(m.store, { password: 'NewPass123' });
  assert.equal(r.code, 'ACTIVATED'); assert.equal(m.users.length, 1); assert.equal(m.users[0].id, 'old'); assert.equal(m.users[0].password, 'NewPass123'); assert.equal(t.profile_id, 'old'); assert.equal(m.roles.old, 'TEACHER');
});
test('existing auth user NOT yet linked to the teacher (profile_id null): found by email, linked, same id', async () => {
  const t = T(); const m = mk([t], [{ id: 'old', email: E, activated: false }], { old: 'TEACHER' }); const r = await run(m.store);
  assert.equal(r.code, 'ACTIVATED'); assert.equal(t.profile_id, 'old'); assert.equal(m.users.length, 1);
});
test('existing auth user with a different email than the teacher record is moved to the teacher email so Login-ID sign-in works', async () => {
  const t = T({ profile_id: 'old' }); const m = mk([t], [{ id: 'old', email: 'poomit11verma@gmail.com', activated: false }], { old: 'TEACHER' }); await run(m.store);
  assert.equal(m.users[0].email, E);
});
test('input is normalised: spaces, upper case, zero-width chars, NBSP', async () => {
  const m = mk([T()]); const r = await run(m.store, { employeeId: ' t010​ ', email: '  PoonIT11Verma@Gmail.com ' }); assert.equal(r.code, 'ACTIVATED');
});
test('stored data with stray spaces / capitals in employee_id and email still matches', async () => {
  const m = mk([T({ employee_id: ' T010 ', email: ' PoonIT11verma@gmail.com ', login_id: null })]); const r = await run(m.store);
  assert.equal(r.code, 'ACTIVATED'); assert.equal(r.loginId, 'T010');
});
test('specific error messages', async () => {
  const m = mk([T(), T({ id: 't2', employee_id: 'T011', email: 'x@y.com', status: 'INACTIVE' })]);
  assert.equal((await run(m.store, { employeeId: 'T999' })).message, MSG_NOT_FOUND);
  assert.equal((await run(m.store, { email: 'wrong@x.com', ip: '2.2.2.2' })).message, MSG_EMAIL);
  assert.equal((await run(m.store, { employeeId: 'T011', email: 'x@y.com', ip: '3.3.3.3' })).message, MSG_INACTIVE);
  assert.equal(m.users.length, 0);
});
test('fully activated account says so and does not touch the password', async () => {
  const t = T({ profile_id: 'old' }); const m = mk([t], [{ id: 'old', email: E, activated: true, password: 'Orig1234' }], { old: 'TEACHER' });
  const r = await run(m.store, { password: 'Other1234' }); assert.equal(r.code, 'ALREADY'); assert.equal(r.message, MSG_ALREADY); assert.equal(m.users[0].password, 'Orig1234');
});
test('activating twice leaves exactly one Auth user', async () => {
  const m = mk([T()]); await run(m.store); assert.equal((await run(m.store)).code, 'ALREADY'); assert.equal(m.users.length, 1);
});
test('an ADMIN profile can never be taken over', async () => {
  const t = T(); const m = mk([t], [{ id: 'adm', email: E, activated: false, password: 'Admin1234' }], { adm: 'ADMIN' }); const r = await run(m.store);
  assert.equal(r.code, 'ADMIN_EMAIL'); assert.equal(m.users[0].password, 'Admin1234'); assert.equal(t.profile_id, null);
});
test('failed linking rolls back a newly created user', async () => {
  const m = mk([T()]); m.setFailLink(true); assert.equal((await run(m.store)).code, 'ERROR'); assert.equal(m.users.length, 0);
});
test('database read error is reported as an error, NOT as a mismatch', async () => {
  const m = mk([T()]); m.store.findTeacher = async () => { throw new Error('boom'); }; const r = await run(m.store); assert.equal(r.code, 'ERROR');
});
test('weak passwords rejected', async () => {
  const m = mk([T()]); for (const p of ['short1', 'allletters', '12345678']) assert.equal((await run(m.store, { password: p })).code, 'WEAK'); assert.equal(passwordProblem('Good1234'), null);
});
test('brute force is throttled', async () => {
  const m = mk([T()]); for (let i = 0; i < 8; i++) await run(m.store, { email: `x${i}@x.com`, ip: `9.9.9.${i}` });
  assert.equal((await run(m.store)).code, 'RATE_LIMIT');
});
test('login: Login ID resolves to the teacher email even with stray spaces / case in the table', async () => {
  const rows = [{ email: ' PoonIT11verma@gmail.com ', status: 'ACTIVE', login_id: ' T010', employee_id: 'T010 ' }];
  const client: any = { from: () => ({ select: () => ({ ilike: () => ({ limit: async () => ({ data: rows }) }) }) }) };
  assert.equal(await resolveLoginEmail(client, 't010'), E);
});

import { loginErrorMessage, BAD_CREDENTIALS } from '../lib/loginError';
test('login errors: wrong password stays generic; config problems are surfaced', () => {
  assert.equal(loginErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }), BAD_CREDENTIALS);
  assert.match(loginErrorMessage({ message: 'Invalid API key', status: 401 }), /configuration error/);
  assert.match(loginErrorMessage({ message: 'fetch failed', status: 0 }), /Cannot reach/);
  assert.match(loginErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' }), /not confirmed/);
  assert.match(loginErrorMessage({ status: 429, message: 'x' }), /Too many/);
});

import { describeMismatch, normEmail } from '../lib/teacherActivation';
test('canonical form ignores NBSP, zero-width, BOM, soft-hyphen, full-width letters and case', () => {
  const E2 = 'poonit11verma@gmail.com';
  for (const raw of [E2, ` ${E2} `, 'POONIT11VERMA@GMAIL.COM', 'poonit11verma@gmail.com​', '﻿poonit11verma@gmail.com', 'poon­it11verma@gmail.com', 'ｐｏｏｎｉｔ11verma@gmail.com', 'poonit11verma@gmail.com\r\n', 'poonit11verma @gmail.com'])
    assert.equal(normEmail(raw), E2, JSON.stringify(raw));
});
test('a genuinely different address (poomit vs poonit) is still rejected and the server diagnostic points at the differing character without revealing the address', async () => {
  const m = mk([T({ email: 'poomit11verma@gmail.com' })]);
  const logs: string[] = []; const orig = console.error; console.error = (...a: any[]) => logs.push(a.join(' '));
  try { const r = await run(m.store); assert.equal(r.code, 'EMAIL_MISMATCH'); assert.equal(m.users.length, 0); } finally { console.error = orig; }
  assert.equal(logs.length, 1); assert.match(logs[0], /"firstDifferenceAtIndex":3/); assert.doesNotMatch(logs[0], /poomit11verma@gmail\.com|poonit11verma@gmail\.com/);
  assert.equal(describeMismatch('a@b.co', 'a@b.co').firstDifferenceAtIndex, -1);
});
test('lookup falls back to login_id when employee_id differs', async () => {
  const t = T({ employee_id: 'EMP-10', login_id: 'T010' }); const m = mk([t]);
  m.store.findTeacher = async (id) => (t.employee_id.toLowerCase() === id ? t : t.login_id!.toLowerCase() === id ? t : null);
  assert.equal((await run(m.store)).code, 'ACTIVATED');
});
