-- Enable secure class-specific activity grade assignments for teachers.
alter table public.teacher_grade_assignments enable row level security;
grant select, insert, update, delete on public.teacher_grade_assignments to authenticated;

drop policy if exists teacher_grade_assignments_self_read on public.teacher_grade_assignments;
create policy teacher_grade_assignments_self_read
  on public.teacher_grade_assignments for select to authenticated
  using (app.is_admin() or teacher_id = app.my_teacher_id());

drop policy if exists teacher_grade_assignments_admin_write on public.teacher_grade_assignments;
create policy teacher_grade_assignments_admin_write
  on public.teacher_grade_assignments for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Include activity-assigned classes in the teacher's visible class sections.
create or replace function app.my_class_sections() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct a.class_section_id
  from teacher_assignments a
  where a.teacher_id = app.my_teacher_id()
  union
  select distinct cs.id
  from class_sections cs
  join teacher_grade_assignments ga
    on ga.class_id = cs.class_id and ga.session_id = cs.session_id
  where ga.teacher_id = app.my_teacher_id()
$$;

-- Activity teachers may open class-level grade batches, but application
-- save logic must restrict them to the activity IDs assigned to them.
create or replace function app.can_open_batch(p_exam uuid, p_cs uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teacher_assignments a
    where a.teacher_id = app.my_teacher_id() and a.class_section_id = p_cs
      and ((p_subject is not null and a.role = 'SUBJECT' and a.class_subject_id = p_subject)
        or (p_subject is null and a.role = 'CLASS'))
  ) or (
    p_subject is null and exists (
      select 1 from class_sections cs
      join teacher_grade_assignments ga on ga.class_id = cs.class_id and ga.session_id = cs.session_id
      where cs.id = p_cs and ga.teacher_id = app.my_teacher_id()
    )
  )
$$;

create or replace function app.teaches_batch(p_batch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mark_batches b
    join teacher_assignments a on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id()
    where b.id = p_batch
      and ((b.class_subject_id is not null and a.role = 'SUBJECT' and a.class_subject_id = b.class_subject_id)
        or (b.class_subject_id is null and a.role = 'CLASS'))
  ) or exists (
    select 1 from mark_batches b
    join class_sections cs on cs.id = b.class_section_id
    join teacher_grade_assignments ga on ga.class_id = cs.class_id and ga.session_id = cs.session_id
    where b.id = p_batch and b.class_subject_id is null and ga.teacher_id = app.my_teacher_id()
  )
$$;
