import {PGlite} from '@electric-sql/pglite';
import fs from 'fs';
const M=new URL('../supabase/migrations/',import.meta.url).pathname;
const db=new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;`);
for(const f of fs.readdirSync(M).sort()){await db.exec(fs.readFileSync(M+f,'utf8'));console.log('applied',f);}
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m);}else console.log('ok  ',m);};
const q=async(s,p)=>(await db.query(s,p)).rows;
const as=async(uid)=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid||''}',false); ${uid?'set role authenticated':''}`);};
const err=async(s,p)=>{try{await db.query(s,p);return null;}catch(e){return e.message;}};
const adminId=(await q("insert into auth.users(email) values ('admin@x.com') returning id"))[0].id;
const teachId=(await q("insert into auth.users(email) values ('t1@x.com') returning id"))[0].id;
await q("update profiles set role='ADMIN' where id=$1",[adminId]);
const S=(await q("select id from academic_sessions"))[0].id;

// non-admin cannot call admin functions
await as(teachId);
ok(/Only administrators/.test(await err("select public.create_session('2027-28',null,null)")||''),'teacher blocked from create_session');
ok(/Only administrators/.test(await err("select public.commit_import_students(gen_random_uuid(),'CREATE')")||''),'teacher blocked from import commit');
await as(adminId);

// ---- student import ----
const rows=[
 {_status:'OK',scholar_number:'S100',name:'Asha Patel',father_name:'R Patel',class_id:6,section:'A',roll_number:1,gender:'F',dob:'2014-05-01'},
 {_status:'OK',scholar_number:'S101',name:'Ravi Sharma',father_name:'K Sharma',class_id:6,section:'A',roll_number:2,gender:'M'},
 {_status:'OK',scholar_number:'S102',name:'Meena Joshi',class_id:11,section:'',stream:'Science',roll_number:1},
 {_status:'OK',scholar_number:'S103',name:'Kiran Das',class_id:11,section:'',stream:'Commerce',roll_number:1,academic_session:'2026–27'},
 {_status:'ERROR',scholar_number:'BAD',name:'x',class_id:99},
];
const B=(await q("insert into import_batches(kind,rows) values ('STUDENTS',$1) returning id",[JSON.stringify(rows)]))[0].id;
let r=(await q("select public.commit_import_students($1,'CREATE') r",[B]))[0].r;
ok(r.created===4&&r.skipped===0&&r.enrolled===4,'4 students created: '+JSON.stringify(r));
ok(+(await q("select count(*) c from students"))[0].c===4,'error row not imported');
ok(+(await q("select count(*) c from class_sections where session_id=$1",[S]))[0].c===3,'class sections auto-created (VI-A, XI Science, XI Commerce)');
ok((await q("select label from class_sections where stream_id is not null order by label")).map(x=>x.label).join()==='XI Commerce,XI Science','stream class-section labels');
ok(/already been processed/.test(await err("select public.commit_import_students($1,'CREATE')",[B])||''),'cannot commit twice');
// re-import: skip existing vs update
const rows2=[{_status:'OK',scholar_number:'S100',name:'Asha P. Patel',class_id:6,section:'B',roll_number:5},{_status:'OK',scholar_number:'S200',name:'New Kid',class_id:6,section:'B',roll_number:6}];
const B2=(await q("insert into import_batches(kind,rows) values ('STUDENTS',$1) returning id",[JSON.stringify(rows2)]))[0].id;
r=(await q("select public.commit_import_students($1,'CREATE') r",[B2]))[0].r;
ok(r.created===1&&r.skipped===1,'CREATE mode skips existing: '+JSON.stringify(r));
const B3=(await q("insert into import_batches(kind,rows) values ('STUDENTS',$1) returning id",[JSON.stringify([rows2[0]])]))[0].id;
r=(await q("select public.commit_import_students($1,'UPDATE') r",[B3]))[0].r;
ok(r.updated===1,'UPDATE mode updates existing');
ok((await q("select s.name,cs.label from students s join student_class_enrollments e on e.student_id=s.id join class_sections cs on cs.id=e.class_section_id where scholar_number='S100'"))[0].label==='VI-B','student moved to VI-B, still one student record');
ok(+(await q("select count(*) c from student_class_enrollments e join students s on s.id=e.student_id where s.scholar_number='S100'"))[0].c===1,'no duplicate enrollment');
// atomic rollback: duplicate roll in same section aborts whole import
const rows4=[{_status:'OK',scholar_number:'S300',name:'A',class_id:7,section:'A',roll_number:1},{_status:'OK',scholar_number:'S301',name:'B',class_id:7,section:'A',roll_number:1}];
const B4=(await q("insert into import_batches(kind,rows) values ('STUDENTS',$1) returning id",[JSON.stringify(rows4)]))[0].id;
const e4=await err("select public.commit_import_students($1,'CREATE')",[B4]);
ok(!!e4&&+(await q("select count(*) c from students where scholar_number in ('S300','S301')"))[0].c===0,'failed import rolls back completely');

// ---- teacher import (master data only) ----
const trows=[
 {_status:'OK',employee_id:'E1',name:'Neha Verma',email:'Neha@School.com',login_id:'neha.v',designation:'PGT',status:'ACTIVE'},
 {_status:'OK',employee_id:'E2',name:'Rahul Sir',email:'rahul@school.com',login_id:'rahul',status:'ACTIVE'},
 {_status:'OK',employee_id:'E3',name:'Old Teacher',status:'INACTIVE'},
 {_status:'ERROR',employee_id:'E4',name:'Bad Row'},
];
const TB=(await q("insert into import_batches(kind,rows) values ('TEACHERS',$1) returning id",[JSON.stringify(trows)]))[0].id;
r=(await q("select public.commit_import_teachers($1,'CREATE') r",[TB]))[0].r;
ok(r.created===3&&r.skipped===0,'teacher import: '+JSON.stringify(r));
ok((await q("select email,login_id,status from teachers where employee_id='E1'"))[0].email==='neha@school.com','email lowercased');
ok((await q("select status from teachers where employee_id='E3'"))[0].status==='INACTIVE','Inactive status imported');
ok(+(await q("select count(*) c from teachers where employee_id='E4'"))[0].c===0,'error row not imported');
const TB2=(await q("insert into import_batches(kind,rows) values ('TEACHERS',$1) returning id",[JSON.stringify([{_status:'OK',employee_id:'E1',name:'Neha V.',mobile:'999',status:'ACTIVE'}])]))[0].id;
r=(await q("select public.commit_import_teachers($1,'CREATE') r",[TB2]))[0].r;
ok(r.skipped===1&&r.created===0,'existing teacher skipped in CREATE mode');
const TB3=(await q("insert into import_batches(kind,rows) values ('TEACHERS',$1) returning id",[JSON.stringify([{_status:'OK',employee_id:'E1',name:'Neha V.',mobile:'999',status:'ACTIVE'}])]))[0].id;
r=(await q("select public.commit_import_teachers($1,'UPDATE') r",[TB3]))[0].r;
ok(r.updated===1&&(await q("select name,mobile,email from teachers where employee_id='E1'"))[0].mobile==='999','UPDATE mode updates, keeps email');
const TB4=(await q("insert into import_batches(kind,rows) values ('TEACHERS',$1) returning id",[JSON.stringify([{_status:'OK',employee_id:'E9',name:'Dup Login',login_id:'NEHA.V'}])]))[0].id;
ok(!!(await err("select public.commit_import_teachers($1,'CREATE')",[TB4])),'duplicate login id rejected (whole import rolls back)');
ok(+(await q("select count(*) c from teachers where employee_id='E9'"))[0].c===0,'rolled back');

// ---- assignment import ----
const arows=[
 {_status:'OK',employee_id:'E1',academic_session:'2026–27',class_id:6,section:'A',subject:'Mathematics'},
 {_status:'OK',employee_id:'E1',academic_session:'2026-27',class_id:6,section:'A',subject:'Science'},
 {_status:'OK',employee_id:'E1',class_id:6,section:'B',subject:'Mathematics'},
 {_status:'OK',employee_id:'E1',class_id:6,section:'A',role:'CLASS'},
 {_status:'OK',employee_id:'E2',class_id:6,section:'A',subject:'English'},
 {_status:'OK',employee_id:'E2',class_id:11,stream:'Science',subject:'Physics'},
 {_status:'ERROR',employee_id:'NOPE',class_id:6,section:'A',subject:'Hindi'},
];
// class sections VI-B and XI Science must exist (created by student import above: VI-B yes via S100 move, XI Science yes)
const AB=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify(arows)]))[0].id;
r=(await q("select public.commit_import_assignments($1,'SKIP') r",[AB]))[0].r;
ok(r.added===6&&r.already_assigned===0,'assignments added: '+JSON.stringify(r));
const asg=await q("select t.employee_id, cs.label, s.name as subject, a.role, cs.session_id=a.session_id as sess_ok, cs.class_id from teacher_assignments a join teachers t on t.id=a.teacher_id join class_sections cs on cs.id=a.class_section_id left join class_subjects c on c.id=a.class_subject_id left join subjects s on s.id=c.subject_id order by 1,2,3");
ok(asg.every(x=>x.sess_ok),'every assignment is linked to the right session via its class section');
ok(asg.some(x=>x.employee_id==='E2'&&x.label==='XI Science'&&x.subject==='Physics'),'XI Science stream assignment resolved');
ok(asg.some(x=>x.employee_id==='E1'&&x.role==='CLASS'&&x.label==='VI-A'),'class teacher assignment created');
// idempotent
const AB2=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify(arows)]))[0].id;
r=(await q("select public.commit_import_assignments($1,'SKIP') r",[AB2]))[0].r;
ok(r.added===0&&r.already_assigned===6,'re-import adds nothing: '+JSON.stringify(r));
// conflicts: E2 also wants Mathematics VI-A (E1 has it)
const cj=[{_status:'OK',employee_id:'E2',class_id:6,section:'A',subject:'Mathematics'},{_status:'OK',employee_id:'E2',class_id:6,section:'A',role:'CLASS'}];
let CB1=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify(cj)]))[0].id;
r=(await q("select public.commit_import_assignments($1,'SKIP') r",[CB1]))[0].r;
ok(r.added===0&&r.skipped_other_teacher===2,'SKIP leaves existing teachers: '+JSON.stringify(r));
CB1=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify(cj)]))[0].id;
r=(await q("select public.commit_import_assignments($1,'ADD') r",[CB1]))[0].r;
ok(r.added===1&&r.skipped_other_teacher===1,'ADD adds second subject teacher but never a second class teacher: '+JSON.stringify(r));
CB1=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify([{_status:'OK',employee_id:'E2',class_id:6,section:'A',role:'CLASS'}])]))[0].id;
r=(await q("select public.commit_import_assignments($1,'REPLACE') r",[CB1]))[0].r;
ok(r.added===1&&r.replaced===1&&(await q("select t.employee_id from teacher_assignments a join teachers t on t.id=a.teacher_id join class_sections cs on cs.id=a.class_section_id where a.role='CLASS' and cs.label='VI-A'"))[0].employee_id==='E2','REPLACE swaps the class teacher');
// bad data aborts everything
const bad=[{_status:'OK',employee_id:'E1',class_id:7,section:'A',subject:'Hindi'},{_status:'OK',employee_id:'E1',class_id:7,section:'A',subject:'Astrology'}];
const BB=(await q("insert into import_batches(kind,rows) values ('ASSIGNMENTS',$1) returning id",[JSON.stringify(bad)]))[0].id;
const nBefore=+(await q("select count(*) c from teacher_assignments"))[0].c;
ok(!!(await err("select public.commit_import_assignments($1,'SKIP')",[BB])),'unknown subject aborts the import');
ok(+(await q("select count(*) c from teacher_assignments"))[0].c===nBefore,'nothing partially saved');
// non-admin blocked
await as(teachId);
ok(/Only administrators/.test(await err("select public.commit_import_assignments(gen_random_uuid(),'SKIP')")||''),'teacher cannot import assignments');
await as(adminId);

// ---- teacher signs up later: sees ONLY assigned classes/subjects ----
await db.exec('reset role');
const nu=(await q("insert into auth.users(email) values ('neha@school.com') returning id"))[0].id;
ok((await q("select profile_id from teachers where employee_id='E1'"))[0].profile_id===nu,'teacher auto-linked on sign-up (email)');
await as(nu);
const mine=await q("select cs.label, s.name from teacher_assignments a join class_sections cs on cs.id=a.class_section_id left join class_subjects c on c.id=a.class_subject_id left join subjects s on s.id=c.subject_id order by 1,2");
ok(mine.length===3&&mine.every(x=>['VI-A','VI-B'].includes(x.label)),'teacher sees only own assignments: '+JSON.stringify(mine.map(x=>x.label+':'+x.name)));
ok((await q("select distinct label from class_sections")).map(x=>x.label).sort().join()==='VI-A,VI-B','teacher sees only own class sections');
ok(+(await q("select count(*) c from students"))[0].c===+(await q("select count(*) c from student_class_enrollments e join class_sections cs on cs.id=e.class_section_id where cs.label in ('VI-A','VI-B')"))[0].c,'teacher sees only students of own classes');
ok(+(await q("select count(*) c from teachers"))[0].c===1,'teacher sees only own teacher row');
await as(adminId);

// ---- examinations ----
const T1=(await q("select id from examinations where name='Term I'"))[0].id;
const T2=(await q("select public.clone_examination($1,'Term II','Term - II',true) id",[T1]))[0].id;
ok(+(await q("select count(*) c from exam_components where examination_id=$1",[T2]))[0].c===+(await q("select count(*) c from exam_components where examination_id=$1",[T1]))[0].c,'Term II has same component count');
ok((await q("select count(*) c from exam_components where examination_id=$1 and label='PT-II'",[T2]))[0].c>0,'components renamed for Term II');
ok(+(await q("select count(*) c from exam_component_limits l join exam_components c on c.id=l.component_id where c.examination_id=$1",[T2]))[0].c===44,'XI–XII subject limits cloned (44)');
ok(/already exists/.test(await err("select public.clone_examination($1,'term ii','x')",[T1])||''),'duplicate exam name rejected');
const AN=(await q("select public.create_annual_examination($1,'Annual','Annual','WEIGHTED',$2) id",[S,JSON.stringify([{exam_id:T1,weight:40},{exam_id:T2,weight:60}])]))[0].id;
ok(+(await q("select count(*) c from annual_rule_sources s join annual_rules r on r.id=s.rule_id where r.examination_id=$1",[AN]))[0].c===2,'annual rule with 2 sources');

// ---- session + promotion ----
const NS=(await q("select public.create_session('2027–28','2027-04-01','2028-03-31') id"))[0].id;
ok((await q("select label from academic_sessions where id=$1",[NS]))[0].label==='2027-28','session label normalised');
ok(+(await q("select count(*) c from class_subjects where session_id=$1",[NS]))[0].c===+(await q("select count(*) c from class_subjects where session_id=$1",[S]))[0].c,'new session has all subjects');
ok(+(await q("select count(*) c from teacher_assignments where session_id=$1",[NS]))[0].c===+(await q("select count(*) c from teacher_assignments where session_id=$1",[S]))[0].c,'teacher assignments carried forward');
ok(+(await q("select count(*) c from examinations where session_id=$1",[NS]))[0].c===1,'Term I created for new session');
const before=+(await q("select count(*) c from student_class_enrollments where session_id=$1",[S]))[0].c;
r=(await q("select public.promote_students($1,$2) r",[S,NS]))[0].r;
ok(r.promoted>=5,'students promoted: '+JSON.stringify(r));
ok(+(await q("select count(*) c from student_class_enrollments where session_id=$1",[S]))[0].c===before,'old session enrollments untouched');
ok((await q("select cs.label from student_class_enrollments e join class_sections cs on cs.id=e.class_section_id join students s on s.id=e.student_id where s.scholar_number='S101' and e.session_id=$1",[NS]))[0].label==='VII-A','S101 VI-A → VII-A');
ok((await q("select cs.label from student_class_enrollments e join class_sections cs on cs.id=e.class_section_id join students s on s.id=e.student_id where s.scholar_number='S102' and e.session_id=$1",[NS]))[0].label==='XII Science','S102 XI Science → XII Science');
r=(await q("select public.promote_students($1,$2) r",[S,NS]))[0].r;
ok(r.promoted===0&&r.skipped>=5,'second promotion is idempotent');
await db.exec(`select public.activate_session('${NS}')`);
ok((await q("select label from academic_sessions where status='ACTIVE'"))[0].label==='2027-28','session activated');
console.log('fails',fails);process.exit(fails?1:0);
