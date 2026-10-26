-- Computer First Term is assessed out of 50 for Classes I–VIII.
-- Apply a subject-specific override so other subjects retain their configured maximum.
with term_one as (
  select id
  from examinations
  where type = 'TERM'
    and (lower(name) like '%term i%' or lower(name) like '%term 1%' or lower(display_name) like '%term i%' or lower(term_label) like '%term - i%')
),
computer_subjects as (
  select cs.id as class_subject_id
  from class_subjects cs
  join subjects s on s.id = cs.subject_id
  where cs.class_id between 1 and 8
    and cs.kind = 'MARKS'
    and cs.status = 'ACTIVE'
    and lower(coalesce(cs.display_label, s.name)) like '%computer%'
),
first_term_component as (
  select ec.id as component_id
  from exam_components ec
  join term_one e on e.id = ec.examination_id
  where upper(ec.code) = 'FT'
)
insert into exam_component_limits (class_subject_id, component_id, max_marks, is_applicable)
select cs.class_subject_id, ft.component_id, 50, true
from computer_subjects cs
cross join first_term_component ft
on conflict (class_subject_id, component_id)
do update set max_marks = excluded.max_marks, is_applicable = true;
