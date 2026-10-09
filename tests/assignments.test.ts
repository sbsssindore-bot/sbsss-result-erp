import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { groupSections, parseIds, pickSubject, planSubjectAssignments, groupLabel } from '../lib/assignGroups';

const M = path.join(__dirname, '../supabase/migrations');
const SID: Record<string, number> = { Commerce: 801, PCB: 802, PCM: 803, Humanities: 804, Science: 805 };
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sec = (id: number, class_id: number, label: string, stream?: string, section = 'A', roman = 'XI'): any => ({ id: U(id), class_id, label, section_id: U(900), stream_id: stream ? U(SID[stream]) : null, sections: { name: section }, streams: stream ? { name: stream } : null, classes: { roman } });

test('grouping: I–X stay one option per section; XI–XII collapse to one option per section', () => {
  const g = groupSections([sec(1, 9, 'IX-A', undefined, 'A', 'IX'), sec(2, 9, 'IX-B', undefined, 'B', 'IX'), sec(3, 11, 'XI Commerce-A', 'Commerce'), sec(4, 11, 'XI PCB-A', 'PCB'), sec(5, 11, 'XI PCM-A', 'PCM'), sec(6, 12, 'XII Humanities-A', 'Humanities', 'A', 'XII'), sec(7, 12, 'XII PCB-A', 'PCB', 'A', 'XII')]);
  assert.deepEqual(g.map((x) => x.label), ['IX-A', 'IX-B', 'XI-A', 'XII-A']);
  assert.equal(g.find((x) => x.label === 'XI-A')!.ids.length, 3); assert.equal(g.find((x) => x.label === 'XII-A')!.ids.length, 2);
  assert.deepEqual(g.find((x) => x.label === 'XI-A')!.streams.sort(), ['Commerce', 'PCB', 'PCM']);
  assert.equal(groupLabel(sec(3, 11, 'XI Commerce-A', 'Commerce')), 'XI-A');
});
test('checkbox values: single id, comma list, junk is dropped, duplicates removed', () => {
  assert.deepEqual(parseIds([U(1), `${U(2)},${U(3)}`, U(2), 'x', "1' or '1'='1"]), [U(1), U(2), U(3)]);
});

const sub = (id: number, class_id: number, name: string, stream?: string): any => ({ id: U(id), class_id, stream_id: stream ? U(SID[stream]) : null, display_label: name, subjects: { name } });
test('subject goes only to the streams that offer it (own list), common subjects go to all', () => {
  const subs = [sub(10, 11, 'Physics', 'PCB'), sub(11, 11, 'Physics', 'PCM'), sub(12, 11, 'Accountancy', 'Commerce'), sub(13, 11, 'English'), sub(14, 11, 'Biology', 'PCB'), sub(15, 11, 'Mathematics', 'PCM')];
  const secs = [sec(3, 11, 'XI Commerce-A', 'Commerce'), sec(4, 11, 'XI PCB-A', 'PCB'), sec(5, 11, 'XI PCM-A', 'PCM')];
  const run = (names: string[]) => planSubjectAssignments({ sections: secs, subs, existing: [], names, teacher: U(500), mode: 'skip', session: U(700) });
  const phys = run(['physics']);
  assert.deepEqual(phys.add.map((a) => [a.class_section_id, a.class_subject_id]).sort(), [[U(4), U(10)], [U(5), U(11)]].sort(), 'Physics → PCB and PCM only, with each stream\'s own subject row');
  assert.equal(phys.skippedMissing, 1, 'Commerce does not offer Physics');
  assert.equal(run(['english']).add.length, 3);
  assert.deepEqual(run(['accountancy']).add.map((a) => a.class_section_id), [U(3)]);
  assert.deepEqual(run(['biology']).add.map((a) => a.class_section_id), [U(4)]);
});
test('legacy: a stream with no subject list of its own keeps the previous behaviour (same-named subject of the class)', () => {
  const subs = [sub(10, 11, 'Physics', 'Science'), sub(13, 11, 'English')];
  const pcb = sec(4, 11, 'XI PCB-A', 'PCB');
  assert.equal(pickSubject(subs, pcb, 'physics')?.id, U(10));
  assert.equal(pickSubject(subs, pcb, 'english')?.id, U(13));
});
test('modes: skip / add / replace / duplicate against existing teachers', () => {
  const subs = [sub(10, 11, 'Physics', 'PCB')]; const secs = [sec(4, 11, 'XI PCB-A', 'PCB')];
  const ex = [{ id: 'e1', teacher_id: U(501), class_section_id: U(4), class_subject_id: U(10) }];
  const r = (mode: string, teacher = U(500)) => planSubjectAssignments({ sections: secs, subs, existing: ex as any, names: ['physics'], teacher, mode, session: U(700) });
  assert.equal(r('skip').add.length, 0); assert.equal(r('skip').conflicts, 1);
  assert.equal(r('add').add.length, 1); assert.deepEqual(r('replace').removeIds, ['e1']); assert.equal(r('replace').add.length, 1);
  assert.equal(r('skip', U(501)).dup, 1);
});

test('database: teacher assigned "XI-A" sees/enters marks only for the stream sheets + subjects expanded for them (RLS unchanged)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  for (const f of fs.readdirSync(M).sort()) await db.exec(fs.readFileSync(path.join(M, f), 'utf8'));
  const q = async (s: string, p?: any[]) => (await db.query(s, p)).rows as any[];
  const as = async (uid?: string) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); ${uid ? 'set role authenticated' : ''}`); };
  const adminId = (await q("insert into auth.users(email) values ('admin@x.com') returning id"))[0].id; await q("update profiles set role='ADMIN' where id=$1", [adminId]);
  const tUser = (await q("insert into auth.users(email) values ('t@x.com') returning id"))[0].id;
  const tid = (await q("insert into teachers(employee_id,name,email,profile_id) values ('T1','Phys Teacher','t@x.com',$1) returning id", [tUser]))[0].id;
  const S = (await q('select id from academic_sessions'))[0].id; const A = (await q("select id from sections where name='A'"))[0].id;
  const science = (await q("select id from streams where name='Science'"))[0].id, commerce = (await q("select id from streams where name='Commerce'"))[0].id;
  const mk = async (stream: string, label: string) => (await q("insert into class_sections(session_id,class_id,section_id,stream_id,label) values ($1,11,$2,$3,$4) returning id", [S, A, stream, label]))[0].id;
  const csSci = await mk(science, 'XI Science-A'), csCom = await mk(commerce, 'XI Commerce-A');
  await q("update academic_sessions set status='ACTIVE' where id=$1", [S]);
  const rows = (await q("select cs.id, cs.class_id, cs.stream_id, cs.display_label, s.name from class_subjects cs join subjects s on s.id=cs.subject_id where cs.session_id=$1 and cs.class_id=11 and cs.kind='MARKS'", [S])).map((r) => ({ id: r.id, class_id: r.class_id, stream_id: r.stream_id, display_label: r.display_label, subjects: { name: r.name } }));
  const secs = [{ id: csSci, class_id: 11, label: 'XI Science-A', stream_id: science, section_id: A }, { id: csCom, class_id: 11, label: 'XI Commerce-A', stream_id: commerce, section_id: A }] as any;
  const plan = planSubjectAssignments({ sections: secs, subs: rows as any, existing: [], names: ['physics'], teacher: tid, mode: 'skip', session: S });
  assert.equal(plan.add.length, 1); assert.equal(plan.add[0].class_section_id, csSci);
  await as(adminId);
  for (const a of plan.add) await q('insert into teacher_assignments(session_id,teacher_id,class_section_id,class_subject_id,role) values ($1,$2,$3,$4,$5)', [a.session_id, a.teacher_id, a.class_section_id, a.class_subject_id, a.role]);
  const ex = (await q("select id from examinations where session_id=$1 order by sequence limit 1", [S]))[0].id;
  const physics = rows.find((r) => r.subjects.name === 'Physics')!.id, accountancy = rows.find((r) => r.subjects.name === 'Accountancy')!.id;
  await as(tUser);
  const can = async (cs: string, sub: string) => (await q('select app.can_open_batch($1,$2,$3) ok', [ex, cs, sub]))[0].ok;
  assert.equal(await can(csSci, physics), true, 'Physics in XI Science-A: allowed');
  assert.equal(await can(csCom, physics), false, 'Physics in XI Commerce-A: not allowed');
  assert.equal(await can(csCom, accountancy), false, 'Accountancy: not assigned');
  assert.equal(await can(csSci, accountancy), false);
  assert.equal((await q('select id from teacher_assignments')).length, 1, 'teacher sees only own assignment rows');
  await as(); await db.close();
});
