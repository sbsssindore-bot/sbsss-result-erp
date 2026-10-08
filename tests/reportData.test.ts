import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { loadCards } from '../lib/reportData';
import { renderCard, renderDocument } from '../lib/reportCard';

const M = path.join(__dirname, '../supabase/migrations');
function mockSb(db: PGlite) {
  return {
    from(table: string) {
      const f: ((r: any) => boolean)[] = []; let rg: [number, number] | null = null;
      const run = async () => {
        const { rows } = await db.query(`select * from ${table}`);
        let r = rows.filter((x: any) => f.every((g) => g(x)));
        if (rg) r = r.slice(rg[0], rg[1] + 1);
        return r;
      };
      const api: any = {
        select() { return api; }, eq(c: string, v: any) { f.push((r) => r[c] === v); return api; },
        in(c: string, vs: any[]) { f.push((r) => vs.includes(r[c])); return api; }, range(a: number, b: number) { rg = [a, b]; return api; },
        async maybeSingle() { const r = await run(); return { data: r[0] ?? null, error: null }; },
        then(res: any, rej: any) { run().then((r) => res({ data: r, error: null }), rej); },
      };
      return api;
    },
  };
}

test('report cards are built from database rows (class X and XI Science)', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  for (const f of fs.readdirSync(M).sort()) await db.exec(fs.readFileSync(path.join(M, f), 'utf8'));
  const q = async (s: string, p?: any[]) => (await db.query(s, p)).rows as any[];
  const S = (await q('select id from academic_sessions'))[0].id;
  const EX = (await q("select id from examinations where name='Term I'"))[0].id;
  const cs = async (c: number, sec: string | null, st: string | null) => (await q(
    `insert into class_sections(session_id,class_id,section_id,stream_id,label) values ($1,$2,(select id from sections where name=$3),(select id from streams where name=$4),$5) returning id`,
    [S, c, sec, st, `${c}-${sec || st}`]))[0].id;
  const XA = await cs(10, 'A', null), XIS = await cs(11, 'A', 'Science');
  const stu = async (n: string, scholar: string, c: string, roll: number) => {
    const s = (await q(`insert into students(scholar_number,name,father_name,mother_name) values ($1,$2,'Father','Mother') returning id`, [scholar, n]))[0].id;
    return (await q(`insert into student_class_enrollments(student_id,session_id,class_section_id,roll_number) values ($1,$2,$3,$4) returning id`, [s, S, c, roll]))[0].id;
  };
  const e1 = await stu('Reyansh Tiwari', 'S1', XA, 1), e2 = await stu('Aanya Verma', 'S2', XIS, 1);

  // class X: IT marks 8 / 8.5 / 74
  const IT = (await q("select id from class_subjects where class_id=10 and display_label='Information Technology'"))[0].id;
  const B1 = (await q('insert into mark_batches(examination_id,class_section_id,class_subject_id) values ($1,$2,$3) returning id', [EX, XA, IT]))[0].id;
  const comp = async (tpl: string, code: string) => (await q("select id from exam_components where examination_id=$1 and template_code=$2 and code=$3", [EX, tpl, code]))[0].id;
  for (const [code, v] of [['PT1', 8], ['MT', 8.5], ['FT', 74]] as const)
    await q('insert into marks(batch_id,enrollment_id,examination_id,class_subject_id,component_id,value) values ($1,$2,$3,$4,$5,$6)', [B1, e1, EX, IT, await comp('E', code), v]);
  // class XI Science: Physics chosen for slot 4, practical 27 + theory 63
  const PH = (await q("select id from class_subjects where class_id=11 and display_label='Physics'"))[0].id;
  const grp = (await q("select id from subject_groups where template_code='F' and slot_no=4"))[0].id;
  await q('insert into student_subject_choices(enrollment_id,subject_group_id,class_subject_id) values ($1,$2,$3)', [e2, grp, PH]);
  const B2 = (await q('insert into mark_batches(examination_id,class_section_id,class_subject_id) values ($1,$2,$3) returning id', [EX, XIS, PH]))[0].id;
  for (const [code, v] of [['PRAC', 27], ['FT', 63]] as const)
    await q('insert into marks(batch_id,enrollment_id,examination_id,class_subject_id,component_id,value) values ($1,$2,$3,$4,$5,$6)', [B2, e2, EX, PH, await comp('F', code), v]);
  // attendance + co-scholastic for class X
  const CB = (await q('insert into mark_batches(examination_id,class_section_id) values ($1,$2) returning id', [EX, XA]))[0].id;
  await q('insert into attendance(batch_id,enrollment_id,examination_id,working_days,present_days) values ($1,$2,$3,80,72)', [CB, e1, EX]);
  const area = (await q("select id from co_scholastic_areas where class_id=10 and name='Discipline'"))[0].id;
  await q("insert into co_scholastic_marks(batch_id,enrollment_id,examination_id,area_id,grade) values ($1,$2,$3,$4,'A')", [CB, e1, EX, area]);

  const sb = mockSb(db);
  const [x] = await loadCards(sb, EX, [e1]);
  assert.equal(x.template.code, 'E');
  assert.equal(x.hasCode, true);
  assert.deepEqual(x.headers.map((h) => `${h.label}(${h.maxText})`), ['PT-I(10)', 'MT(10)', 'First Term(80)']);
  assert.equal(x.rows.length, 6);
  const it = x.rows.find((r) => r.label === 'Information Technology')!;
  assert.deepEqual([it.code, it.total, it.grade, it.cells.join()], ['402', '90.5', 'A2', '8,8.5,74']);
  assert.equal(x.attendance, '72');
  assert.equal(x.co.find((c) => c.label === 'Discipline')!.grade, 'A');
  assert.equal(x.co.length, 3);
  assert.match(x.summaryValue, /incomplete/);
  assert.equal(x.resultStatus, '—');

  const [y] = await loadCards(sb, EX, [e2]);
  assert.equal(y.template.code, 'F');
  assert.equal(y.rows.length, 6);
  assert.deepEqual(y.headers.map((h) => `${h.label}(${h.maxText})`), ['PRAC/PROJ(30/20)', 'First Term(80/70)']);
  const ph = y.rows[3];
  assert.deepEqual([ph.label, ph.code, ph.total, ph.grade], ['Physics', '042', '90', 'A2']);
  assert.equal(y.rows[0].label, 'English'); assert.equal(y.rows[0].total, '');
  assert.equal(y.co.length, 0);

  const html = renderCard(x);
  assert.ok(!/Aligned with NEP/.test(html) && !/Grade X/.test(html));
  assert.ok(html.includes('TERM I EXAMINATION REPORT CARD') && html.includes('ACADEMIC SESSION 2026-27'));
  assert.ok(html.includes('class="wm"') && html.includes('class="lg"'));
  assert.ok(renderCard(y).includes('SUMMARY &amp; ATTESTATION') && !renderCard(y).includes('&amp; &amp;'));
  const doc = renderDocument([html, renderCard(y)], 'url(x.png)');
  assert.ok(doc.includes('--logo:url(x.png)'));
  // layout order differs per template (X: legend before summary, XI-XII: no co-scholastic)
  assert.ok(html.indexOf('GRADE LEGEND') < html.indexOf('OVERALL PERFORMANCE SUMMARY'));
});
