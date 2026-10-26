-- Robustly apply Computer First Term maximum marks for Classes I–VIII.
-- Covers common exam labels such as "First Terminal Examination", "First Term",
-- "Term I", and "Term 1". This is safe to run even if migration 0014 was not applied.
with first_term as (
  select e.id as examination_id
  from public.examinations e
  where e.type = 'TERM'
    and (
      lower(coalesce(e.name, '')) like '%first term%'
      or lower(coalesce(e.name, '')) like '%first terminal%'
      or lower(coalesce(e.name, '')) like '%term i%'
      or lower(coalesce(e.name, '')) like '%term 1%'
      or lower(coalesce(e.name, '')) like '%term-1%'
      or lower(coalesce(e.display_name, '')) like '%first term%'
      or lower(coalesce(e.display_name, '')) like '%first terminal%'
      or lower(coalesce(e.display_name, '')) like '%term i%'
      or lower(coalesce(e.display_name, '')) like '%term 1%'
      or lower(coalesce(e.display_name, '')) like '%term-1%'
      or lower(coalesce(e.term_label, '')) like '%first term%'
      or lower(coalesce(e.term_label, '')) like '%first terminal%'
      or lower(coalesce(e.term_label, '')) like '%term i%'
      or lower(coalesce(e.term_label, '')) like '%term 1%'
      or lower(coalesce(e.term_label, '')) like '%term-1%'
    )
),
computer_subjects as (
  select cs.id as class_subject_id
  from public.class_subjects cs
  join public.subjects s on s.id = cs.subject_id
  where cs.class_id between 1 and 8
    and cs.kind = 'MARKS'
    and cs.status = 'ACTIVE'
    and (
      lower(coalesce(cs.display_label, '')) like '%computer%'
      or lower(coalesce(s.name, '')) like '%computer%'
    )
),
first_term_component as (
  select ec.id as component_id
  from public.exam_components ec
  join first_term ft on ft.examination_id = ec.examination_id
  where upper(ec.code) = 'FT'
)
insert into public.exam_component_limits (class_subject_id, component_id, max_marks, is_applicable)
select cs.class_subject_id, ft.component_id, 50, true
from computer_subjects cs
cross join first_term_component ft
on conflict (class_subject_id, component_id)
do update set max_marks = excluded.max_marks, is_applicable = true;
