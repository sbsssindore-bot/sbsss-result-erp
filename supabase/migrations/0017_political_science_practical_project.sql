-- Political Science in Classes XI–XII should use the same PRAC/PROJ + First Term
-- structure as other subjects in the report-card template, totaling 100 marks.
with political_science as (
  select cs.id as class_subject_id
  from public.class_subjects cs
  join public.subjects s on s.id = cs.subject_id
  where cs.class_id in (11, 12)
    and cs.status = 'ACTIVE'
    and lower(s.name) = 'political science'
)
insert into public.exam_component_limits (class_subject_id, component_id, max_marks, is_applicable)
select ps.class_subject_id, ec.id,
       case ec.code when 'PRAC' then 20 when 'FT' then 80 end,
       true
from political_science ps
join public.exam_components ec
  on ec.template_code = 'F'
 and ec.code in ('PRAC', 'FT')
join public.examinations ex
  on ex.id = ec.examination_id
 and ex.type = 'TERM'
on conflict (class_subject_id, component_id)
do update set
  max_marks = excluded.max_marks,
  is_applicable = true;
