-- Put History in the Physics/Business Studies slot, keeping the
-- Mathematics/Biology/Accountancy/Political Science slot unchanged.
update public.subject_groups
set label = case slot_no
  when 2 then 'Mathematics/Biology/Accountancy/Political Science'
  when 3 then 'Chemistry/Economics'
  when 4 then 'Physics/Business Studies/History'
  else label
end
where template_code = 'F' and slot_no in (2, 3, 4);

update public.class_subjects cs
set subject_group_id = target_group.id,
    display_order = 15
from public.subjects s
join public.subject_groups target_group
  on target_group.template_code = 'F' and target_group.slot_no = 4
where cs.subject_id = s.id
  and s.name = 'History'
  and cs.class_id in (11, 12);

-- Ensure History is not duplicated in the Chemistry/Economics group.
