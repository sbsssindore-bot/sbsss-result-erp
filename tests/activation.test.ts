import test from 'node:test';
import assert from 'node:assert/strict';
import { activateTeacher, MSG_ALREADY, MSG_MISMATCH, passwordProblem, type ActivationStore, type TeacherRow } from '../lib/teacherActivation';

function mk(teachers: TeacherRow[], profiles: { id: string; email: string; role: string }[] = []) {
  const authUsers: string[] = []; const attempts: { employeeId: string; ip: string; ok: boolean }[] = []; let failLink = false;
  const store: ActivationStore = {
    async failuresSince(_m, by) { return attempts.filter((a) => !a.ok && (by.ip ? a.ip === by.ip : a.employeeId.toLowerCase() === by.employeeId!.toLowerCase())).length; },
    async recordAttempt(a) { attempts.push(a); },
    async findTeacher(id) { return teachers.find((t) => t.employee_id.toLowerCase() === id.toLowerCase()) || null; },
    async findProfileByEmail(e) { return profiles.find((p) => p.email.toLowerCase() === e) || null; },
    async createAuthUser(email) { if (authUsers.includes(email) || profiles.some((p) => p.email === email)) return { exists: true }; authUsers.push(email); return { id: 'u-' + email }; },
    async deleteAuthUser(id) { const i = authUsers.indexOf(id.slice(2)); if (i >= 0) authUsers.splice(i, 1); },
    async upsertTeacherProfile(id, email) { profiles.push({ id, email, role: 'TEACHER' }); return null; },
    async linkTeacher(tid, pid, login) { if (failLink) return 'boom'; const t = teachers.find((x) => x.id === tid)!; if (t.profile_id) return 'already'; t.profile_id = pid; t.login_id = login; return null; },
  };
  return { store, authUsers, attempts, profiles, setFailLink: (v: boolean) => { failLink = v; } };
}
const T = (o: Partial<TeacherRow> = {}): TeacherRow => ({ id: 't1', employee_id: 'T010', name: 'Naina Verma', email: 'naina@x.com', login_id: null, profile_id: null, status: 'ACTIVE', ...o });
const run = (s: ActivationStore, o: any = {}) => activateTeacher(s, { employeeId: 'T010', email: 'naina@x.com', password: 'Passw0rdX', ip: '1.1.1.1', ...o });

test('valid ID + email creates Auth user, profile TEACHER, links teacher and sets login_id', async () => {
  const t = T(); const m = mk([t]); const r = await run(m.store);
  assert.equal(r.code, 'ACTIVATED'); assert.equal(r.loginId, 'T010');
  assert.equal(t.profile_id, 'u-naina@x.com'); assert.equal(t.login_id, 'T010'); assert.equal(m.profiles[0].role, 'TEACHER'); assert.equal(m.authUsers.length, 1);
});
test('email is matched case-insensitively and ID too', async () => {
  const m = mk([T()]); assert.equal((await run(m.store, { employeeId: 't010', email: ' NAINA@X.com ' })).code, 'ACTIVATED');
});
test('wrong email and unknown ID give the SAME message (no ID probing) and no account is created', async () => {
  const m = mk([T()]);
  const a = await run(m.store, { email: 'other@x.com' }); const b = await run(m.store, { employeeId: 'T999' });
  assert.equal(a.message, MSG_MISMATCH); assert.equal(b.message, MSG_MISMATCH); assert.equal(m.authUsers.length, 0);
});
test('knowing only the employee ID is not enough', async () => {
  const m = mk([T()]); const r = await run(m.store, { email: 'attacker@evil.com' }); assert.equal(r.ok, false); assert.equal(m.authUsers.length, 0);
});
test('already activated is reported gracefully; no duplicate user', async () => {
  const t = T({ profile_id: 'p1', login_id: 'T010' }); const m = mk([t]); const r = await run(m.store);
  assert.equal(r.code, 'ALREADY'); assert.equal(r.message, MSG_ALREADY); assert.equal(m.authUsers.length, 0);
});
test('activating twice only creates one Auth user', async () => {
  const m = mk([T()]); await run(m.store); const r2 = await run(m.store); assert.equal(r2.code, 'ALREADY'); assert.equal(m.authUsers.length, 1);
});
test('inactive teacher cannot activate', async () => {
  const m = mk([T({ status: 'INACTIVE' })]); assert.equal((await run(m.store)).code, 'INACTIVE'); assert.equal(m.authUsers.length, 0);
});
test('existing TEACHER auth account (T010 test case) is linked, not duplicated, password untouched', async () => {
  const t = T(); const m = mk([t], [{ id: 'old', email: 'naina@x.com', role: 'TEACHER' }]); const r = await run(m.store);
  assert.equal(r.code, 'LINKED'); assert.equal(t.profile_id, 'old'); assert.equal(m.authUsers.length, 0); assert.equal(m.profiles.length, 1);
});
test('an email that belongs to an ADMIN profile can never be activated as teacher', async () => {
  const t = T(); const m = mk([t], [{ id: 'adm', email: 'naina@x.com', role: 'ADMIN' }]); const r = await run(m.store);
  assert.equal(r.code, 'ADMIN_EMAIL'); assert.equal(t.profile_id, null); assert.equal(m.profiles[0].role, 'ADMIN');
});
test('if linking fails the new Auth user is rolled back', async () => {
  const m = mk([T()]); m.setFailLink(true); const r = await run(m.store);
  assert.equal(r.code, 'ERROR'); assert.equal(m.authUsers.length, 0);
});
test('weak passwords are rejected before any lookup', async () => {
  const m = mk([T()]);
  for (const p of ['short1', 'allletters', '12345678']) assert.equal((await run(m.store, { password: p })).code, 'WEAK');
  assert.equal(passwordProblem('Good1234'), null); assert.equal(m.authUsers.length, 0);
});
test('brute force is throttled per employee ID and per IP', async () => {
  const m = mk([T()]);
  for (let i = 0; i < 6; i++) await run(m.store, { email: `x${i}@x.com`, ip: `9.9.9.${i}` });
  assert.equal((await run(m.store)).code, 'RATE_LIMIT');
  const m2 = mk([T()]);
  for (let i = 0; i < 20; i++) await run(m2.store, { employeeId: `Z${i}`, email: 'a@b.co' });
  assert.equal((await run(m2.store, { employeeId: 'Z99' })).code, 'RATE_LIMIT');
});
test('malformed IDs/emails are rejected', async () => {
  const m = mk([T()]); assert.equal((await run(m.store, { employeeId: "T010' or 1=1" })).message, MSG_MISMATCH); assert.equal((await run(m.store, { email: 'nope' })).code, 'INVALID');
});
