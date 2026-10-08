/* Generates real PDFs through the same code path as /api/report-pdf, using a seeded in-memory Postgres.
   Run:  npx tsx scripts/pdf-smoke.ts  (writes ./out/*.pdf) */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { loadCards } from '../lib/reportData';
import { renderCard, renderDocument } from '../lib/reportCard';
import { logoCssForPdf } from '../lib/logo';

const M = path.join(__dirname, '../supabase/migrations');
function mockSb(db: PGlite) {
  return { from(table: string) {
    const f: ((r: any) => boolean)[] = []; let rg: [number, number] | null = null;
    const run = async () => { const { rows } = await db.query(`select * from ${table}`); let r = rows.filter((x: any) => f.every((g) => g(x))); if (rg) r = r.slice(rg[0], rg[1] + 1); return r; };
    const api: any = { select() { return api; }, eq(c: string, v: any) { f.push((r) => r[c] === v); return api; }, in(c: string, vs: any[]) { f.push((r) => vs.includes(r[c])); return api; },
      range(a: number, b: number) { rg = [a, b]; return api; }, async maybeSingle() { const r = await run(); return { data: r[0] ?? null, error: null }; }, then(res: any, rej: any) { run().then((r) => res({ data: r, error: null }), rej); } };
    return api; } };
}
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  for (const f of fs.readdirSync(M).sort()) await db.exec(fs.readFileSync(path.join(M, f), 'utf8'));
  const q = async (s: string, p?: any[]) => (await db.query(s, p)).rows as any[];
  const S = (await q('select id from academic_sessions'))[0].id, EX = (await q("select id from examinations where name='Term I'"))[0].id;
  const classes = [1, 5, 8, 9, 10, 11];
  const ids: string[] = [];
  for (const c of classes) {
    const stream = c >= 11 ? 'Science' : null;
    const cs = (await q(`insert into class_sections(session_id,class_id,section_id,stream_id,label) values ($1,$2,(select id from sections where name='A'),(select id from streams where name=$3),$4) returning id`, [S, c, stream, `C${c}`]))[0].id;
    const stu = (await q(`insert into students(scholar_number,name,father_name,mother_name) values ($1,$2,'Rajesh Sharma','Sunita Sharma') returning id`, ['SC' + c, `Test Student ${c}`]))[0].id;
    const en = (await q(`insert into student_class_enrollments(student_id,session_id,class_section_id,roll_number) values ($1,$2,$3,1) returning id`, [stu, S, cs]))[0].id;
    ids.push(en);
    let subs = await q(`select cs.*, s.name from class_subjects cs join subjects s on s.id=cs.subject_id where cs.session_id=$1 and cs.class_id=$2 and cs.kind='MARKS'`, [S, c]);
    if (c >= 11) { // one subject per slot (Science stream)
      const pick = ['English', 'Mathematics', 'Chemistry', 'Physics', 'Physical Education', 'Information Technology'];
      subs = subs.filter((x: any) => pick.includes(x.name));
      for (const sub of subs) await q('insert into student_subject_choices(enrollment_id,subject_group_id,class_subject_id) values ($1,$2,$3)', [en, sub.subject_group_id, sub.id]);
    }
    const tpl = (await q('select code from report_card_templates where $1 between min_class and max_class', [c]))[0].code;
    const comps = await q('select * from exam_components where examination_id=$1 and template_code=$2', [EX, tpl]);
    for (const sub of subs) {
      const b = (await q('insert into mark_batches(examination_id,class_section_id,class_subject_id) values ($1,$2,$3) returning id', [EX, cs, sub.id]))[0].id;
      for (const comp of comps) {
        const lim = (await q('select * from exam_component_limits where class_subject_id=$1 and component_id=$2', [sub.id, comp.id]))[0];
        const mx = Number(lim?.max_marks ?? comp.max_marks);
        await q('insert into marks(batch_id,enrollment_id,examination_id,class_subject_id,component_id,value) values ($1,$2,$3,$4,$5,$6)', [b, en, EX, sub.id, comp.id, Math.round(mx * 0.78 * 2) / 2]);
      }
    }
    const cb = (await q('insert into mark_batches(examination_id,class_section_id) values ($1,$2) returning id', [EX, cs]))[0].id;
    await q('insert into attendance(batch_id,enrollment_id,examination_id,working_days,present_days) values ($1,$2,$3,200,184)', [cb, en, EX]);
    for (const a of await q('select id from co_scholastic_areas where class_id=$1', [c])) await q("insert into co_scholastic_marks(batch_id,enrollment_id,examination_id,area_id,grade) values ($1,$2,$3,$4,'A')", [cb, en, EX, a.id]);
    await q("insert into report_remarks(batch_id,enrollment_id,examination_id,remarks,result_status) values ($1,$2,$3,'Good progress. Keep it up.','PASS')", [cb, en, EX]);
  }
  const sb = mockSb(db);
  const cards = (await Promise.all(ids.map((id) => loadCards(sb, EX, [id])))).flat();
  const settings = (await q('select * from school_settings'))[0];
  const html = renderDocument(cards.map(renderCard), await logoCssForPdf(settings));
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/cards.html', html);
  const browser = await puppeteer.launch({ args: chromium.args, headless: 'shell', executablePath: process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath()) });
  const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'load' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '7mm', bottom: '7mm', left: '7mm', right: '7mm' } });
  await browser.close();
  fs.writeFileSync('out/report-cards-sample.pdf', pdf);
  console.log('cards', cards.length, 'pdf bytes', pdf.length, cards.map((c) => c.fileName).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
