import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES } from '../lib/importTemplates';
import { FIELDS, type Kind } from '../lib/importFields';
import { autoMap, extractAssignments, extractStudents, extractTeachers, missingRequired, parseSheet } from '../lib/importParse';
import { toStoredRows, validateAssignments, validateStudents, validateTeachers } from '../lib/importValidate';
import { resolveLoginEmail } from '../lib/loginId';

const csvOf = (k: keyof typeof TEMPLATES) => { const t = TEMPLATES[k]; return '\uFEFF' + XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([[...t.head], ...t.rows.map((r) => [...r])])); };
const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

test('CSV: UTF-8 (Hindi), BOM, quoted commas and leading zeros survive', () => {
  const csv = '\uFEFFTeacher ID,Teacher Name,Mobile\n"007","आरव शर्मा, M.Sc",098000\n,,\nT2,Neha,1';
  const { headers, rows } = parseSheet(buf(csv), 'x.csv');
  assert.deepEqual(headers, ['Teacher ID', 'Teacher Name', 'Mobile']);
  assert.equal(rows.length, 2);
  assert.equal(String(rows[0]['Teacher ID']), '007'); assert.equal(rows[0]['Teacher Name'], 'आरव शर्मा, M.Sc'); assert.equal(String(rows[0]['Mobile']), '098000');
});
test('Excel (.xlsx) is read as well', () => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Teacher ID', 'Teacher Name'], ['T9', 'Asha']]), 'S');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const { rows } = parseSheet(out, 'x.xlsx'); assert.equal(rows[0]['Teacher Name'], 'Asha');
});
test('every sample template maps fully and needs no manual mapping', () => {
  for (const [slug, kind] of [['students', 'STUDENTS'], ['teachers', 'TEACHERS'], ['assignments', 'ASSIGNMENTS']] as [keyof typeof TEMPLATES, Kind][]) {
    const { headers } = parseSheet(buf(csvOf(slug)), 'x.csv'); const m = autoMap(kind, headers);
    assert.deepEqual(missingRequired(kind, m), [], `${slug}: required mapped`);
    assert.deepEqual(Object.values(m).sort(), [...headers].sort(), `${slug}: every template column is recognised`);
  }
});
test('different column names are recognised (Login ID / Username, Active/Inactive, Std, Sec)', () => {
  assert.equal(autoMap('TEACHERS', ['Employee Code', 'Name', 'Username', 'Active/Inactive', 'Contact No'])['login_id'], 'Username');
  assert.equal(autoMap('TEACHERS', ['Employee Code', 'Name', 'Username', 'Active/Inactive'])['status'], 'Active/Inactive');
  const a = autoMap('ASSIGNMENTS', ['Teacher Code', 'Session', 'Std', 'Sec', 'Subject Name']);
  assert.deepEqual(missingRequired('ASSIGNMENTS', a), []);
});

/* ---- full pipeline against a real PostgreSQL ---- */
const M = path.join(__dirname, '../supabase/migrations');
test('students → teachers → assignments: preview, validation, import, and teacher visibility', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  for (const f of fs.readdirSync(M).sort()) await db.exec(fs.readFileSync(path.join(M, f), 'utf8'));
  const q = async (s: string, p?: any[]) => (await db.query(s, p)).rows as any[];
  const as = async (uid?: string) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); ${uid ? 'set role authenticated' : ''}`); };
  const adminId = (await q("insert into auth.users(email) values ('admin@x.com') returning id"))[0].id;
  await q("update profiles set role='ADMIN' where id=$1", [adminId]);
  await as(adminId);
  const sessions = await q('select id,label from academic_sessions'); const activeId = sessions[0].id;
  const read = (k: keyof typeof TEMPLATES, kind: Kind) => { const { headers, rows } = parseSheet(buf(csvOf(k)), 'x.csv'); return { rows, mapping: autoMap(kind, headers) }; };
  const stage = async (kind: Kind, items: any[]) => (await q('insert into import_batches(kind,rows) values ($1,$2) returning id', [kind, JSON.stringify(toStoredRows(items))]))[0].id;

  // 1. students
  const s = read('students', 'STUDENTS'); const sItems = extractStudents(s.rows, s.mapping);
  const rep = validateStudents(sItems, { sessions, activeId, dbStudents: [], dbRolls: new Map(), sectionKeys: new Set() });
  assert.equal(sItems.filter((i) => i.errors.length).length, 0, JSON.stringify(sItems.map((i) => i.errors)));
  assert.deepEqual(rep.newSections.sort(), ['VI-A', 'VI-B', 'XI Science']);
  assert.ok(rep.normalized.some((n) => n.from === 'Class VI' && n.to === 'VI'), 'standardised values are reported');
  const r1 = (await q("select public.commit_import_students($1,'CREATE') r", [await stage('STUDENTS', sItems)]))[0].r;
  assert.equal(r1.created, 4);

  // 2. teachers
  const t = read('teachers', 'TEACHERS'); const tItems = extractTeachers(t.rows, t.mapping);
  validateTeachers(tItems, { sessions, dbTeachers: [] });
  assert.equal(tItems.filter((i) => i.errors.length).length, 0, JSON.stringify(tItems.map((i) => i.errors)));
  assert.equal(tItems[2].data.status, 'INACTIVE'); assert.equal(tItems[0].data.login_id, 'neha.verma');
  assert.ok(tItems[2].warnings.some((w) => /no email/.test(w)));
  const r2 = (await q("select public.commit_import_teachers($1,'CREATE') r", [await stage('TEACHERS', tItems)]))[0].r;
  assert.equal(r2.created, 3);
  assert.equal((await q("select status,login_id from teachers where employee_id='T003'"))[0].status, 'INACTIVE');
  // re-validation now flags the duplicates
  const again = extractTeachers(t.rows, t.mapping); const rep2 = validateTeachers(again, { sessions, dbTeachers: await q('select employee_id,email,login_id from teachers') });
  assert.equal(rep2.existing, 3);
  const clash = extractTeachers([{ 'Teacher ID': 'T777', 'Teacher Name': 'Clash', Email: 'neha@example.com', 'Login ID': 'RAHUL.SHARMA' }], { employee_id: 'Teacher ID', name: 'Teacher Name', email: 'Email', login_id: 'Login ID' });
  validateTeachers(clash, { sessions, dbTeachers: await q('select employee_id,email,login_id from teachers') });
  assert.ok(clash[0].errors.some((e) => /email already belongs/.test(e)) && clash[0].errors.some((e) => /login ID already used/.test(e)));

  // 3. assignments
  const ctxOf = async () => ({
    sessions, activeId,
    teachers: await q('select id,employee_id,name,status from teachers'),
    classSections: await q('select cs.id,cs.session_id,cs.class_id,sec.name section,st.name stream from class_sections cs left join sections sec on sec.id=cs.section_id left join streams st on st.id=cs.stream_id'),
    classSubjects: await q('select c.id,c.session_id,c.class_id,s.name,c.display_label label,st.name stream from class_subjects c join subjects s on s.id=c.subject_id left join streams st on st.id=c.stream_id'),
    assignments: await q('select a.teacher_id,a.class_section_id,a.class_subject_id,a.role,t.name teacher_name from teacher_assignments a join teachers t on t.id=a.teacher_id'),
  });
  const a = read('assignments', 'ASSIGNMENTS'); const aItems = extractAssignments(a.rows, a.mapping);
  validateAssignments(aItems, await ctxOf());
  assert.equal(aItems.filter((i) => i.errors.length).length, 0, JSON.stringify(aItems.map((i) => i.errors)));
  assert.equal(aItems[3].data.role, 'CLASS');
  const r3 = (await q("select public.commit_import_assignments($1,'SKIP') r", [await stage('ASSIGNMENTS', aItems)]))[0].r;
  assert.equal(r3.added, 5);
  // foreign keys: every assignment resolves to teacher, session, class, section and subject records
  const fk = await q(`select a.id from teacher_assignments a join teachers t on t.id=a.teacher_id join class_sections cs on cs.id=a.class_section_id
      join academic_sessions se on se.id=a.session_id and se.id=cs.session_id join classes c on c.id=cs.class_id left join sections sc on sc.id=cs.section_id
      left join class_subjects csu on csu.id=a.class_subject_id left join subjects su on su.id=csu.subject_id where a.role='CLASS' or su.id is not null`);
  assert.equal(fk.length, 5);

  // negative cases are reported with a clear reason
  const bad = extractAssignments([
    { 'Teacher ID': 'NOPE', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Mathematics' },
    { 'Teacher ID': 'T001', 'Academic Session': '2026-27', Class: 'VI', Section: 'Z', Subject: 'Mathematics' },
    { 'Teacher ID': 'T001', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Astrology' },
    { 'Teacher ID': 'T001', 'Academic Session': '2030-31', Class: 'VI', Section: 'A', Subject: 'Hindi' },
    { 'Teacher ID': 'T001', 'Academic Session': '2026-27', Class: 'Nursery', Section: 'A', Subject: 'Hindi' },
    { 'Teacher ID': 'T001', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: '' },
    { 'Teacher ID': 'T002', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Hindi' },
    { 'Teacher ID': 'T002', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Hindi' },
    { 'Teacher ID': 'T001', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Mathematics' },
    { 'Teacher ID': 'T002', 'Academic Session': '2026-27', Class: 'VI', Section: 'A', Subject: 'Mathematics' },
  ], a.mapping);
  const rep3 = validateAssignments(bad, await ctxOf());
  const msg = bad.map((b) => b.errors.join(' | '));
  assert.match(msg[0], /not found \(import teachers first\)/); assert.match(msg[1], /VI-Z does not exist/); assert.match(msg[2], /“Astrology” is not offered/);
  assert.match(msg[3], /session “2030-31” not found/); assert.match(msg[4], /unknown value/); assert.match(msg[5], /subject: missing/);
  assert.equal(msg[6], ''); assert.match(msg[7], /duplicate of row/);
  assert.match(bad[8].warnings.join(), /already assigned/); assert.match(bad[9].warnings.join(), /already assigned to Neha Verma/);
  assert.equal(rep3.existing, 1); assert.equal(rep3.conflicts, 1);

  // 4. a teacher logs in later and sees ONLY what was assigned
  await as(); const uid = (await q("insert into auth.users(email) values ('neha@example.com') returning id"))[0].id; await as(uid);
  const mine = await q("select cs.label,s.name subject,a.role from teacher_assignments a join class_sections cs on cs.id=a.class_section_id left join class_subjects c on c.id=a.class_subject_id left join subjects s on s.id=c.subject_id order by 1");
  assert.deepEqual(mine.map((m) => `${m.label}:${m.subject}`), ['VI-A:Mathematics', 'VI-B:Mathematics', 'XI Science:Physics']);
  assert.deepEqual((await q('select label from class_sections order by 1')).map((x) => x.label), ['VI-A', 'VI-B', 'XI Science']);
  assert.equal((await q('select count(*)::int c from students'))[0].c, 4);
  assert.equal((await q('select count(*)::int c from teachers'))[0].c, 1);
  await as(adminId);

  // 5. Login ID / Teacher ID resolve to the right email, inactive or unknown do not
  const client = { from: (table: string) => { let col = '', pat = ''; const api: any = { select() { return api; }, ilike(c: string, p: string) { col = c; pat = p; return api; },
    async limit() { const rows = await q(`select email,status,login_id,employee_id from ${table} where ${col} ilike $1`, [pat]); return { data: rows }; }, then(r: any, j: any) { return this.limit().then(r, j); } }; return api; } };
  await db.exec('reset role');
  assert.equal(await resolveLoginEmail(client, 'neha.verma'), 'neha@example.com');
  assert.equal(await resolveLoginEmail(client, 'NEHA.VERMA'), 'neha@example.com');
  assert.equal(await resolveLoginEmail(client, 'T001'), 'neha@example.com');
  assert.equal(await resolveLoginEmail(client, 'T003'), null);
  assert.equal(await resolveLoginEmail(client, 'nobody'), null);
  assert.equal(await resolveLoginEmail(client, "x' or 1=1 --"), null);
  assert.equal(await resolveLoginEmail(client, 'neha_verma'), null, 'underscore is not a wildcard');
});
