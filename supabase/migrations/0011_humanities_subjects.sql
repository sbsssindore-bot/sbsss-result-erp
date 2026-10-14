-- Add Humanities/Arts subjects to existing XI-XII report-card slots.
-- History shares the Mathematics/Biology/Accountancy slot; Political Science
-- shares the Physics/Business Studies slot, as requested by the school.
insert into subjects (name, code)
values ('History', '027'), ('Political Science', '028')
on conflict do nothing;

update subject_groups
set label = 'Mathematics/Biology/Accountancy/History'
where template_code = 'F' and slot_no = 2;

update subject_groups
set label = 'Physics/Business Studies/Political Science'
where template_code = 'F' and slot_no = 4;

insert into class_subjects
  (session_id, class_id, subject_id, stream_id, subject_group_id, display_label, display_order)
select sess.id, cl.class_id, subj.id, null, grp.id, subj.name, ord.display_order
from academic_sessions sess
cross join (values (11, 12), (12, 12)) as cl(class_id, display_order)
join subjects subj on (subj.name = 'History' and subj.code = '027')
                  or (subj.name = 'Political Science' and subj.code = '028')
join subject_groups grp on grp.template_code = 'F'
  and grp.slot_no = case when subj.name = 'History' then 2 else 4 end
cross join lateral (select cl.display_order + case when subj.name = 'History' then 0 else 1 end as display_order) ord
where sess.status = 'ACTIVE'
  and not exists (
    select 1 from class_subjects existing
    where existing.session_id = sess.id
      and existing.class_id = cl.class_id
      and existing.subject_id = subj.id
      and existing.stream_id is null
  );
