-- =====================================================================
-- SBSSS Result ERP — 0003 reference data + session defaults
-- Source of truth: 1st-12th_template_final.pdf (six report-card structures)
-- Everything below is configuration data. Admin can change it from the UI.
-- =====================================================================
insert into roles (key, name) values ('ADMIN', 'Administrator'), ('TEACHER', 'Teacher');

insert into classes (id, name, roman)
select n, 'Class ' || r, r
from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12],
            array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']) as t(n, r);

insert into sections (name) values ('A'), ('B'), ('C'), ('D'), ('E');
insert into streams (name) values ('Science'), ('Commerce');
insert into co_grade_values (value, label, sort_order) values ('A','A',1),('B','B',2),('C','C',3),('D','D',4),('E','E',5);

insert into result_statuses (code, label, sort_order) values
  ('PASS','PASS',1),('FAIL','FAIL',2),('PROMOTED','PROMOTED',3),
  ('NEEDS IMPROVEMENT','NEEDS IMPROVEMENT',4),('ABSENT','ABSENT',5),('WITHHELD','WITHHELD',6);

insert into result_rules (name, rule, is_default) values
  ('Manual (no automatic rule)', '{"mode":"manual"}', true),
  ('Percentage and required subjects', '{"mode":"auto","overall_min":33,"subject_min":33,"required_subject_fail":"FAIL","pass":"PASS","fail":"FAIL"}', false);

-- grade scale: lower-bound logic, no gaps for decimal percentages
with s as (insert into grade_scales (name, is_default) values ('Default 9-point scale', true) returning id)
insert into grade_scale_bands (scale_id, grade, min_percentage, sort_order)
select s.id, g, m, o from s, (values ('A1',91,1),('A2',81,2),('B1',71,3),('B2',61,4),('C1',51,5),
                                     ('C2',41,6),('D',33,7),('E1',21,8),('E2',0,9)) as v(g, m, o);

-- report-card templates A–F (layout notes drive the template engine)
insert into report_card_templates (code, name, min_class, max_class, layout) values
 ('A','Class I–III',   1, 3, '{"grade_title":"Grade I / II / III","scholastic_heading":"1. SCHOLASTIC ASSESSMENT","co_heading":"2. CO-SCHOLASTIC & SUBJECT GRADES","summary_heading":"3. OVERALL PERFORMANCE SUMMARY","legend_heading":"GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","legend_after":"summary","subject_code_column":false,"summary_label":"Overall Marks /Percentage:","has_co_scholastic":true}'),
 ('B','Class IV–V',    4, 5, '{"grade_title":"Grade IV & V","scholastic_heading":"1. SCHOLASTIC ASSESSMENT","co_heading":"2. CO-SCHOLASTIC & SUBJECT GRADES","summary_heading":"3. OVERALL PERFORMANCE SUMMARY","legend_heading":"GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","legend_after":"summary","subject_code_column":false,"summary_label":"Overall Marks /Percentage:","has_co_scholastic":true}'),
 ('C','Class VI–VIII', 6, 8, '{"grade_title":"Grade VI - VIII","scholastic_heading":"1. SCHOLASTIC ASSESSMENT","co_heading":"2. CO-SCHOLASTIC & SUBJECT GRADES","summary_heading":"3. OVERALL PERFORMANCE SUMMARY","legend_heading":"GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","legend_after":"summary","subject_code_column":false,"summary_label":"Overall Marks /Percentage:","has_co_scholastic":true}'),
 ('D','Class IX',      9, 9, '{"grade_title":"Grade IX","scholastic_heading":"1. SCHOLASTIC ASSESSMENT","co_heading":"2. CO-SCHOLASTIC & SUBJECT GRADES","summary_heading":"3. OVERALL PERFORMANCE SUMMARY","legend_heading":"GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","legend_after":"summary","subject_code_column":true,"summary_label":"Percentage:","has_co_scholastic":true}'),
 ('E','Class X',      10,10, '{"grade_title":"Grade X","scholastic_heading":"1. CORE SUBJECTS","co_heading":"2. CO-SCHOLASTIC GRADES","legend_heading":"3. GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","summary_heading":"4. OVERALL PERFORMANCE SUMMARY","legend_after":"co_scholastic","subject_code_column":true,"summary_label":"Percentage:","has_co_scholastic":true}'),
 ('F','Class XI–XII', 11,12, '{"grade_title":"Grade XI & XII","scholastic_heading":"1. CORE SUBJECTS","legend_heading":"2. GRADE LEGEND (Based on NEP 2020 & CBSE Guidelines)","summary_heading":"3. OVERALL PERFORMANCE SUMMARY & ATTESTATION","legend_after":"scholastic","subject_code_column":true,"summary_label":"Percentage:","has_co_scholastic":false,"subject_slots":true}');
insert into report_card_configurations (template_code) select code from report_card_templates;

insert into subject_groups (template_code, slot_no, label) values
 ('F',1,'English'),('F',2,'Mathematics/Biology/Accountancy'),('F',3,'Chemistry/Economics'),
 ('F',4,'Physics/Business Studies'),('F',5,'PE'),('F',6,'Information Technology/Applied Maths');

insert into academic_sessions (label, start_date, end_date, status) values ('2026-27', '2026-04-01', '2027-03-31', 'ACTIVE');

insert into school_settings (school_name, address, active_session_id)
select 'SHRI BHARTIYA SANSKRITI SHIKSHA SANSTHAN', 'Indore', id from academic_sessions where label = '2026-27';

-- =====================================================================
-- Per-session defaults: subjects, co-scholastic areas, Term I and its components.
-- Re-usable when a new session is created (clone-forward).
-- =====================================================================
create function public.seed_session_defaults(p_session uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  r record; c smallint; sid uuid; csid uuid; ex uuid; scale uuid; rule uuid; grp uuid; strm uuid; comp uuid;
  lim_prac numeric;
begin
  select id into scale from grade_scales where is_default;
  select id into rule  from result_rules where is_default;
  insert into examinations (session_id, name, display_name, term_label, type, sequence, grade_scale_id, result_rule_id)
    values (p_session, 'Term I', 'Term I', 'Term - I', 'TERM', 1, scale, rule) returning id into ex;

  -- components per template
  insert into exam_components (examination_id, template_code, code, label, max_marks, display_order)
  select ex, t, code, label, mx, o from (values
    ('A','PT1','PT-I',10,1),('A','PORT','Portfolio',10,2),('A','MA','Multiple Assessment',10,3),('A','MT','MT',10,4),('A','ORAL','Oral Assessment',10,5),('A','FT','First Term',50,6),
    ('B','PT1','PT-I',5,1),('B','PORT','Portfolio',5,2),('B','MA','Multiple Assessment',5,3),('B','MT','MT',5,4),('B','FT','First Term',80,5),
    ('C','PT1','PT-I',5,1),('C','PORT','Portfolio',5,2),('C','MA','Multiple Assessment',5,3),('C','MT','MT',5,4),('C','FT','First Term',80,5),
    ('D','PT1','PT-I',5,1),('D','PORT','Portfolio',5,2),('D','MA','Multiple Assessment',5,3),('D','MT','MT',5,4),('D','FT','First Term',80,5),
    ('E','PT1','PT-I',10,1),('E','MT','MT',10,2),('E','FT','First Term',80,3),
    ('F','PRAC','PRAC/PROJ',20,1),('F','FT','First Term',80,2)
  ) as v(t, code, label, mx, o);

  -- subjects offered: (from class, to class, name, code, display label, stream, slot, practical-max, order)
  for r in select * from (values
    (1,5,'Hindi',null,null,null,null,null,1),(1,5,'English',null,null,null,null,null,2),(1,5,'Mathematics',null,null,null,null,null,3),
    (1,5,'EVS',null,null,null,null,null,4),(1,5,'Computer',null,null,null,null,null,5),
    (6,8,'Hindi',null,null,null,null,null,1),(6,8,'English',null,null,null,null,null,2),(6,8,'Mathematics',null,null,null,null,null,3),
    (6,8,'Science',null,null,null,null,null,4),(6,8,'Social Studies',null,null,null,null,null,5),(6,8,'Sanskrit',null,null,null,null,null,6),(6,8,'Computer',null,null,null,null,null,7),
    (9,9,'English','184','English (R1)',null,null,null,1),(9,9,'Hindi','085','Hindi (R2)',null,null,null,2),(9,9,'Sanskrit','122','Sanskrit (R3)',null,null,null,3),
    (9,9,'Mathematics','241',null,null,null,null,4),(9,9,'Science','086',null,null,null,null,5),(9,9,'Social Studies','087',null,null,null,null,6),(9,9,'Information Technology','402',null,null,null,null,7),
    (10,10,'Hindi','085',null,null,null,null,1),(10,10,'English','184',null,null,null,null,2),(10,10,'Mathematics','241',null,null,null,null,3),
    (10,10,'Science','086',null,null,null,null,4),(10,10,'Social Studies','087',null,null,null,null,5),(10,10,'Information Technology','402',null,null,null,null,6),
    (11,12,'English','301',null,null,1,20,1),
    (11,12,'Mathematics','041',null,'Science',2,20,2),(11,12,'Biology','044',null,'Science',2,30,3),(11,12,'Accountancy','055',null,'Commerce',2,20,4),
    (11,12,'Chemistry','043',null,'Science',3,30,5),(11,12,'Economics','030',null,'Commerce',3,20,6),
    (11,12,'Physics','042',null,'Science',4,30,7),(11,12,'Business Studies','054',null,'Commerce',4,20,8),
    (11,12,'Physical Education','048','PE',null,5,30,9),
    (11,12,'Information Technology','802',null,null,6,30,10),(11,12,'Applied Mathematics','241',null,'Commerce',6,20,11)
  ) as v(c1, c2, nm, code, lbl, stream, slot, prac, ord)
  loop
    select id into sid from subjects where lower(name) = lower(r.nm) and coalesce(code,'') = coalesce(r.code,'');
    if sid is null then insert into subjects (name, code) values (r.nm, r.code) returning id into sid; end if;
    strm := null; if r.stream is not null then select id into strm from streams where name = r.stream; end if;
    grp  := null; if r.slot   is not null then select id into grp  from subject_groups where template_code = 'F' and slot_no = r.slot; end if;
    for c in r.c1 .. r.c2 loop
      insert into class_subjects (session_id, class_id, subject_id, stream_id, subject_group_id, display_label, display_order)
      values (p_session, c, sid, strm, grp, coalesce(r.lbl, r.nm), r.ord) returning id into csid;
      if r.prac is not null then
        select id into comp from exam_components where examination_id = ex and template_code = 'F' and code = 'PRAC';
        insert into exam_component_limits (class_subject_id, component_id, max_marks) values (csid, comp, r.prac);
        select id into comp from exam_components where examination_id = ex and template_code = 'F' and code = 'FT';
        insert into exam_component_limits (class_subject_id, component_id, max_marks) values (csid, comp, 100 - r.prac);
      end if;
    end loop;
  end loop;

  -- co-scholastic activities and graded rows
  insert into co_scholastic_areas (session_id, class_id, name, kind, display_order)
  select p_session, cl, nm, k, o from (
    select cl, nm, 'ACTIVITY' as k, o from unnest(array[1,2,3,4,5,6,7,8]) as cl,
      unnest(array['Art & Craft','Music','Dance','Sports','Life Skill','General Knowledge','Value Education'], array[1,2,3,4,5,6,7]) as u(nm, o)
    union all select cl, 'Sanskrit', 'SUBJECT_GRADE', 8 from unnest(array[4,5]) as cl
    union all select 9, nm, k, o from (values ('Art Education','ACTIVITY',1),('Health & Physical Education','ACTIVITY',2),('Discipline','ACTIVITY',3),('Accounts','SUBJECT_GRADE',4)) as a(nm, k, o)
    union all select 10, nm, 'ACTIVITY', o from (values ('Art Education',1),('Health & Physical Education',2),('Discipline',3)) as a(nm, o)
  ) z;
end $$;

select public.seed_session_defaults((select id from academic_sessions where label = '2026-27'));
revoke execute on function public.seed_session_defaults(uuid) from public, anon, authenticated;
