-- Class teachers need read-only visibility into every subject sheet in their assigned class,
-- and edit rights for class-level entries (attendance, co-scholastic grades, remarks/status).
-- Subject marks remain read-only to class teachers.
create policy class_teacher_read_all_class_batches on mark_batches
for select to authenticated
using (
  app.is_admin() or exists (
    select 1 from teacher_assignments a
    where a.teacher_id = app.my_teacher_id()
      and a.class_section_id = mark_batches.class_section_id
      and a.role = 'CLASS'
  )
);

create policy class_teacher_read_subject_marks on marks
for select to authenticated
using (
  app.is_admin() or exists (
    select 1 from mark_batches b
    join teacher_assignments a
      on a.class_section_id = b.class_section_id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    where b.id = marks.batch_id
      and b.class_subject_id is not null
  )
);

create policy class_teacher_read_class_entries on attendance
for select to authenticated
using (
  app.is_admin() or exists (
    select 1 from mark_batches b
    join teacher_assignments a
      on a.class_section_id = b.class_section_id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    where b.id = attendance.batch_id and b.class_subject_id is null
  )
);
create policy class_teacher_read_co_scholastic on co_scholastic_marks
for select to authenticated
using (
  app.is_admin() or exists (
    select 1 from mark_batches b
    join teacher_assignments a
      on a.class_section_id = b.class_section_id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    where b.id = co_scholastic_marks.batch_id and b.class_subject_id is null
  )
);
create policy class_teacher_read_report_remarks on report_remarks
for select to authenticated
using (
  app.is_admin() or exists (
    select 1 from mark_batches b
    join teacher_assignments a
      on a.class_section_id = b.class_section_id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    where b.id = report_remarks.batch_id and b.class_subject_id is null
  )
);

-- Class teachers may update class-level records after submission, but never after locking.
-- The trigger below mirrors that rule. Subject marks keep the original DRAFT-only workflow.
create policy class_teacher_insert_class_entries on attendance
for insert to authenticated
with check (
  exists (
    select 1 from mark_batches b
    join teacher_assignments a
      on a.class_section_id = b.class_section_id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    where b.id = attendance.batch_id and b.class_subject_id is null
      and b.status <> 'LOCKED'
  )
);
create policy class_teacher_update_class_entries on attendance
for update to authenticated
using (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = attendance.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
)
with check (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = attendance.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);

create policy class_teacher_insert_co_scholastic on co_scholastic_marks
for insert to authenticated
with check (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = co_scholastic_marks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);
create policy class_teacher_update_co_scholastic on co_scholastic_marks
for update to authenticated
using (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = co_scholastic_marks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
)
with check (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = co_scholastic_marks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);
create policy class_teacher_delete_co_scholastic on co_scholastic_marks
for delete to authenticated
using (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = co_scholastic_marks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);

create policy class_teacher_insert_report_remarks on report_remarks
for insert to authenticated
with check (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = report_remarks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);
create policy class_teacher_update_report_remarks on report_remarks
for update to authenticated
using (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = report_remarks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
)
with check (
  exists (select 1 from mark_batches b join teacher_assignments a
    on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id() and a.role = 'CLASS'
    where b.id = report_remarks.batch_id and b.class_subject_id is null and b.status <> 'LOCKED')
);

create or replace function app.check_class_entry() returns trigger language plpgsql as $$
declare b mark_batches; is_class_teacher boolean;
begin
  select * into b from mark_batches where id = new.batch_id;
  if not found then raise exception 'Entry sheet not found.'; end if;
  if b.status = 'LOCKED' then raise exception 'Exam is locked.'; end if;
  select exists (
    select 1 from teacher_assignments a
    where a.teacher_id = app.my_teacher_id()
      and a.class_section_id = b.class_section_id
      and a.role = 'CLASS'
  ) into is_class_teacher;
  if b.status <> 'DRAFT' and not app.is_privileged()
     and not (is_class_teacher and b.class_subject_id is null) then
    raise exception 'These entries are already submitted. Ask the administrator to return them for editing.';
  end if;
  if b.class_subject_id is not null or b.examination_id <> new.examination_id then
    raise exception 'These entries do not belong to this sheet.';
  end if;
  if not exists (select 1 from student_class_enrollments e
                 where e.id = new.enrollment_id and e.class_section_id = b.class_section_id and e.status = 'ACTIVE') then
    raise exception 'Student is not enrolled in this class section.';
  end if;
  new.entered_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
