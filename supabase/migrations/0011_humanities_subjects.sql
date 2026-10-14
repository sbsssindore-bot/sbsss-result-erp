-- Add Humanities/Arts subject options to the existing XI-XII report-card slots.
-- History shares Mathematics/Biology/Accountancy (slot 2).
-- Political Science shares Physics/Business Studies (slot 4).
-- Safe for existing student choices and marks.
update public.subject_groups
set label = case slot_no
  when 2 then 'Mathematics/Biology/Accountancy/History'
  when 4 then 'Physics/Business Studies/Political Science'
  else label
end
where template_code = 'F' and slot_no in (2, 4);

insert into public.subjects (name, code)
values ('History', '027'), ('Political Science', '028')
on conflict (lower(name), (coalesce(code, ''))) do nothing;

insert into public.class_subjects
  (session_id, class_id, subject_id, stream_id, subject_group_id, display_label, display_order)
select sess.id, cls.class_id, subj.id, null, grp.id, subj.name, ord.display_order
from public.academic_sessions sess
cross join (values (11::smallint), (12::smallint)) as cls(class_id)
join public.subjects subj on
  (subj.name = 'History' and subj.code = '027')
  or (subj.name = 'Political Science' and subj.code = '028')
join public.subject_groups grp on grp.template_code = 'F'
  and grp.slot_no = case when subj.name = 'History' then 2 else 4 end
join (values ('History', 12), ('Political Science', 14)) as ord(name, display_order)
  on ord.name = subj.name
where sess.status = 'ACTIVE'
  and not exists (
    select 1 from public.class_subjects existing
    where existing.session_id = sess.id
      and existing.class_id = cls.class_id
      and existing.subject_id = subj.id
      and existing.stream_id is null
  );

-- These are theory subjects: 100 marks theory, no practical component.
insert into public.exam_component_limits (class_subject_id, component_id, max_marks, is_applicable)
select cs.id, ec.id,
       case ec.code when 'PRAC' then 0 else 100 end,
       ec.code <> 'PRAC'
from public.class_subjects cs
join public.subjects s on s.id = cs.subject_id and s.name in ('Political Science', 'History')
join public.exam_components ec on ec.template_code = 'F' and ec.code in ('PRAC', 'FT')
join public.examinations ex on ex.id = ec.examination_id and ex.session_id = cs.session_id
where cs.class_id in (11, 12)
  and not exists (
    select 1 from public.exam_component_limits l
    where l.class_subject_id = cs.id and l.component_id = ec.id
  );
