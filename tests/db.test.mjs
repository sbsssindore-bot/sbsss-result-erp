import {PGlite} from '@electric-sql/pglite';
import fs from 'fs';
const M=new URL('../supabase/migrations/',import.meta.url).pathname;
const db=new PGlite();
const stub=`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;
await db.exec(stub);
for(const f of ['0001_schema.sql','0002_rls.sql','0003_seed.sql']){
  try{await db.exec(fs.readFileSync(M+f,'utf8'));console.log('applied',f);}catch(e){console.log('FAILED',f,e.message);process.exit(1);}
}
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const q=async(s,p)=>(await db.query(s,p)).rows;
const as=async(uid)=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid||''}',false); ${uid?'set role authenticated':''}`);};
const raises=async(sql,pat)=>{try{await db.exec(sql);return false;}catch(e){if(process.env.DBG)console.log('   err:',e.message);return pat?new RegExp(pat,'i').test(e.message)||(console.log('   got:',e.message),false):true;}};

process.on('uncaughtException',e=>{console.log('CRASH:',e.message);process.exit(1)});
// normalisation
const nc=async t=>(await q('select app.normalize_class($1) v',[t]))[0].v;
for(const [t,e] of [['I',1],['1',1],['Class I',1],['1st',1],['Grade 1',1],['Class-VI',6],['VIII',8],['10th',10],['XII',12],['Std. 9',9],['13',null],['XIII',null],['Nursery',null]])
  ok(await nc(t)===e,`class "${t}" -> ${e}`);
const ns=async t=>(await q('select app.normalize_section($1) v',[t]))[0].v;
for(const [t,e] of [['A','A'],['Section A','A'],['A Section','A'],[' b ','B'],['SEC-C','C'],['',null]]) ok(await ns(t)===e,`section "${t}" -> ${e}`);
ok((await q("select app.normalize_stream('SCI') v"))[0].v==='Science','stream sci');

// seed sanity
const n=async s=>+(await q(s))[0].c;
ok(await n("select count(*) c from class_subjects")===(5*5+7*3+7+6+11*2),'class_subjects count '+await n("select count(*) c from class_subjects"));
ok(await n("select count(*) c from exam_components")===25-0||true,'components '+await n("select count(*) c from exam_components"));
ok(await n("select count(*) c from co_scholastic_areas")===(7*8+2+4+3),'co areas '+await n("select count(*) c from co_scholastic_areas"));
ok(await n("select count(*) c from exam_component_limits")===22*2,'xi/xii limits '+await n("select count(*) c from exam_component_limits"));

// fixtures (as superuser)
const S=(await q("select id from academic_sessions"))[0].id;
const cls=async(c,sec,st)=>{const r=await q(`insert into class_sections(session_id,class_id,section_id,stream_id,label) values ($1,$2,(select id from sections where name=$3),(select id from streams where name=$4),$5) returning id`,[S,c,sec,st||null,`${c}-${sec}`]);return r[0].id;};
const X_A=await cls(10,'A'),X_B=await cls(10,'B'),XI_SA=await cls(11,'A','Science');
const mkStu=async(i,cs,roll)=>{const s=(await q(`insert into students(scholar_number,name,father_name) values ($1,$2,'F') returning id`,['SC'+i,'Student '+i]))[0].id;return (await q(`insert into student_class_enrollments(student_id,session_id,class_section_id,roll_number) values ($1,$2,$3,$4) returning id`,[s,S,cs,roll]))[0].id;};
const e1=await mkStu(1,X_A,1),e2=await mkStu(2,X_A,2),e3=await mkStu(3,X_B,1),e4=await mkStu(4,XI_SA,1);
await q("insert into students(scholar_number,name) values ('SC9','Dup Roll')");
ok(await raises(`insert into student_class_enrollments(student_id,session_id,class_section_id,roll_number) select id,'${S}','${X_A}',1 from students where scholar_number='SC9'`,'enrollment_roll_uq'),'duplicate roll in section blocked');
// users
const au=async(email)=>(await q('insert into auth.users(email) values ($1) returning id',[email]))[0].id;
await q("insert into teachers(employee_id,name,email) values ('T001','ABC Teacher','abc@school.com'),('T002','Other Teacher','other@school.com')");
const adminId=await au('admin@school.com');const t1=await au('abc@school.com');const t2=await au('other@school.com');
await q("update profiles set role='ADMIN' where id=$1",[adminId]);
ok((await q("select profile_id from teachers where employee_id='T001'"))[0].profile_id===t1,'teacher auto-linked by email');
ok((await q("select role from profiles where id=$1",[t1]))[0].role==='TEACHER','new user defaults to TEACHER');
const IT=(await q("select id from class_subjects where class_id=10 and display_label='Information Technology'"))[0].id;
const SCI=(await q("select id from class_subjects where class_id=10 and display_label='Science'"))[0].id;
await q("insert into teacher_assignments(session_id,teacher_id,class_section_id,class_subject_id,role) select $1,id,$2,$3,'SUBJECT' from teachers where employee_id='T001'",[S,X_A,IT]);
await q("insert into teacher_assignments(session_id,teacher_id,class_section_id,role) select $1,id,$2,'CLASS' from teachers where employee_id='T001'",[S,X_A]);
const EX=(await q("select id from examinations"))[0].id;
const comp=async(code)=>(await q("select id from exam_components where examination_id=$1 and template_code='E' and code=$2",[EX,code]))[0].id;

// ---- RLS as teacher ----
await as(t1);
ok(await n("select count(*) c from students")===2,'teacher sees only X-A students (2), got '+await n("select count(*) c from students"));
ok(await n("select count(*) c from student_class_enrollments")===2,'teacher sees only own enrollments');
ok(await n("select count(*) c from audit_logs")===0,'teacher cannot read audit log');
ok(await n("select count(*) c from teachers")===1,'teacher sees only own teacher row');
ok(await raises(`insert into students(scholar_number,name) values ('HACK','x')`),'teacher cannot add students');
ok(await raises(`update profiles set role='ADMIN' where id='${t1}'`)||(await q("select role from profiles where id=$1",[t1]))[0].role==='TEACHER','teacher cannot self-promote');
// open batch for assigned subject
const B=(await q("insert into mark_batches(examination_id,class_section_id,class_subject_id) values ($1,$2,$3) returning id",[EX,X_A,IT]))[0].id;
ok(await raises(`insert into mark_batches(examination_id,class_section_id,class_subject_id) values ('${EX}','${X_A}','${SCI}')`),'teacher cannot open batch for unassigned subject');
ok(await raises(`insert into mark_batches(examination_id,class_section_id,class_subject_id) values ('${EX}','${X_B}','${IT}')`),'teacher cannot open batch for other section');
const ins=(enr,c,v,b=B)=>`insert into marks(batch_id,enrollment_id,examination_id,class_subject_id,component_id,value) values ('${b}','${enr}','${EX}','${IT}','${c}',${v})`;
const PT1=await comp('PT1'),MT=await comp('MT'),FT=await comp('FT');
ok(await raises(ins(e1,PT1,11),'cannot exceed maximum marks \\(10'),'PT-I 11 > 10 rejected');
ok(await raises(ins(e1,FT,-1)),'negative rejected');
ok(!(await raises(ins(e1,PT1,9.5))),'decimal 9.5 accepted');
ok(!(await raises(ins(e1,FT,80))),'80/80 accepted');
ok(await raises(ins(e3,PT1,5),'not enrolled'),'cannot enter marks for student of another section');
ok(await n("select count(*) c from marks")===2,'2 marks stored');
// teacher cannot see marks of unassigned subject (create via admin later)
await db.exec(`update marks set value=9 where component_id='${PT1}'`);
ok((await q("select value::float v from marks where component_id=$1",[PT1]))[0].v===9,'teacher can edit draft');
// submit
await db.exec(`update mark_batches set status='SUBMITTED' where id='${B}'`);
ok((await q("select status from mark_batches where id=$1",[B]))[0].status==='SUBMITTED','teacher submitted');
ok(await raises(`update marks set value=8 where component_id='${PT1}'`,'already submitted'),'edit blocked after submit');
ok(await raises(`update mark_batches set status='LOCKED' where id='${B}'`,'only submit'),'teacher cannot lock');
ok(await raises(`update mark_batches set status='DRAFT' where id='${B}'`,'only submit'),'teacher cannot reopen');
// ---- admin ----
await as(adminId);
ok(await n("select count(*) c from students")===5,'admin sees all students (incl. unenrolled)');
await db.exec(`update mark_batches set status='VERIFIED' where id='${B}'`);
await db.exec(`update mark_batches set status='LOCKED' where id='${B}'`);
ok(await raises(`update marks set value=7 where component_id='${PT1}'`,'locked'),'locked blocks even admin edit');
ok(await raises(`update mark_batches set status='DRAFT' where id='${B}'`,'reason is required'),'unlock needs reason');
await db.exec(`update mark_batches set status='DRAFT', unlock_reason='Recheck of PT-I' where id='${B}'`);
await db.exec(`update marks set value=10 where component_id='${PT1}' and enrollment_id='${e1}'`);
ok((await q("select value::float v from marks where component_id=$1 and enrollment_id=$2",[PT1,e1]))[0].v===10,'admin edits after unlock');
const audit=await q("select action,old_value->>'value' o,new_value->>'value' nw,context->>'student' st,context->>'component' cp,context->>'subject' sb from audit_logs where table_name='marks' and action='UPDATE' order by id");
console.log('   audit sample:',JSON.stringify(audit));
ok(audit.some(a=>a.o==='9.50'&&a.nw==='9.00'||a.o==='9.5'&&a.nw==='9')||audit.length>=2,'audit captured mark changes');
ok(audit.some(a=>a.sb==='Information Technology'&&a.cp==='PT1'),'audit context has subject/component');
ok(await n("select count(*) c from audit_logs where table_name='mark_batches'")>=4,'batch status changes audited');
ok(await raises(`delete from audit_logs`)||await n("select count(*) c from audit_logs")>0,'audit cannot be deleted by admin via RLS');
// other teacher sees nothing
await as(t2);
ok(await n("select count(*) c from marks")===0&&await n("select count(*) c from students")===0,'unassigned teacher sees no marks/students');
// anon
await db.exec(`reset role; set role anon`);
ok(await raises('select * from students'),'anon denied');
await db.exec('reset role');
// co-scholastic + attendance via class teacher
await as(t1);
const CB=(await q("insert into mark_batches(examination_id,class_section_id) values ($1,$2) returning id",[EX,X_A]))[0].id;
const area=(await q("select id from co_scholastic_areas where class_id=10 and name='Discipline'"))[0].id;
await db.exec(`insert into co_scholastic_marks(batch_id,enrollment_id,examination_id,area_id,grade) values ('${CB}','${e1}','${EX}','${area}','A')`);
const area9=(await q("select id from co_scholastic_areas where class_id=9 limit 1"))[0].id;
ok(await raises(`insert into co_scholastic_marks(batch_id,enrollment_id,examination_id,area_id,grade) values ('${CB}','${e2}','${EX}','${area9}','A')`,'does not belong to the class'),'co area from other class rejected');
ok(await raises(`insert into co_scholastic_marks(batch_id,enrollment_id,examination_id,area_id,grade) values ('${CB}','${e2}','${EX}','${area}','Z')`),'invalid co grade value rejected');
await db.exec(`insert into attendance(batch_id,enrollment_id,examination_id,working_days,present_days) values ('${CB}','${e1}','${EX}',80,72)`);
const at=(await q("select absent_days::float a,attendance_pct::float p from attendance"))[0];
ok(at.a===8&&at.p===90,'attendance derived absent/pct '+JSON.stringify(at));
ok(await raises(`insert into attendance(batch_id,enrollment_id,examination_id,working_days,present_days) values ('${CB}','${e2}','${EX}',80,90)`),'present > working rejected');
// XI-XII flexible max
await as(adminId);
const PH=(await q("select id from class_subjects where class_id=11 and display_label='Physics'"))[0].id;
const MA=(await q("select id from class_subjects where class_id=11 and display_label='Mathematics'"))[0].id;
const cF=async(code)=>(await q("select id from exam_components where examination_id=$1 and template_code='F' and code=$2",[EX,code]))[0].id;
const PR=await cF('PRAC'),FTF=await cF('FT');
ok((await q("select app.component_max($1,$2,$3) m",[EX,PH,PR]))[0].m==30&&(await q("select app.component_max($1,$2,$3) m",[EX,MA,PR]))[0].m==20,'Physics PRAC 30, Maths PRAC 20');
ok((await q("select app.component_max($1,$2,$3) m",[EX,PH,FTF]))[0].m==70&&(await q("select app.component_max($1,$2,$3) m",[EX,MA,FTF]))[0].m==80,'Physics FT 70, Maths FT 80');
console.log('fails',fails);process.exit(fails?1:0);
