-- 0008 · Teacher-assignment integrity (additive; no table, column or data is changed or deleted)
--
-- What already exists and is reused unchanged:
--   teacher_assignments (session_id, teacher_id, class_section_id, class_subject_id, role SUBJECT|CLASS)
--   RLS helpers app.teaches_batch / app.can_open_batch: SUBJECT rows open subject sheets, CLASS rows open class-level sheets
--   (attendance, co-scholastic, remarks) — so class-teacher and subject-teacher rights are already stored and checked separately.
--
-- What this migration adds (database-level, so it holds for direct API requests too):
--   1. app.subject_fits_section(): a subject can only be attached to a class section of the SAME session and class, and —
--      when the section has a stream whose own subject list exists — of the SAME stream (or a common subject with no stream).
--   2. teacher_assignments trigger: the session must match the class section's session, and the subject must fit the section.
--   3. mark_batches trigger: same subject↔section rule for every new marks sheet.
--   4. marks trigger (replaces app.check_marks): additionally, a non-admin cannot enter marks for a XI–XII student who did not
--      choose that subject in its slot (student_subject_choices).
--   5. At most ONE class teacher per class section (partial unique index) — created only if existing data has no duplicates.
-- Existing rows are never re-validated or modified; the rules apply to new/changed rows.

create or replace function app.subject_fits_section(p_cs uuid, p_csub uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from class_sections cs join class_subjects s on s.id = p_csub
    where cs.id = p_cs
      and s.session_id = cs.session_id
      and s.class_id   = cs.class_id
      and (   s.stream_id is null
           or cs.stream_id is null
           or s.stream_id = cs.stream_id
           -- legacy: a stream that has no subject list of its own (e.g. created by an import) keeps using the class subjects
           or not exists (select 1 from class_subjects o
                           where o.session_id = cs.session_id and o.class_id = cs.class_id and o.stream_id = cs.stream_id))
  ) $$;

create or replace function app.check_teacher_assignment() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from class_sections cs where cs.id = new.class_section_id and cs.session_id = new.session_id) then
    raise exception 'The class section does not belong to this academic session.';
  end if;
  if new.role = 'SUBJECT' and not app.subject_fits_section(new.class_section_id, new.class_subject_id) then
    raise exception 'This subject is not offered in that class section (class, session or stream does not match).';
  end if;
  return new;
end $$;
drop trigger if exists teacher_assignment_check on teacher_assignments;
create trigger teacher_assignment_check before insert or update on teacher_assignments
  for each row execute function app.check_teacher_assignment();

create or replace function app.check_batch_subject() returns trigger language plpgsql as $$
begin
  if new.class_subject_id is not null and not app.subject_fits_section(new.class_section_id, new.class_subject_id) then
    raise exception 'This subject is not offered in that class section (class, session or stream does not match).';
  end if;
  return new;
end $$;
drop trigger if exists batch_subject_check on mark_batches;
create trigger batch_subject_check before insert or update of class_section_id, class_subject_id on mark_batches
  for each row execute function app.check_batch_subject();

-- app.check_marks: unchanged except the XI–XII subject-choice rule at the end (teachers only; admin/service role are exempt).
create or replace function app.check_marks() returns trigger language plpgsql as $$
declare b mark_batches; mx numeric; grp uuid;
begin
  select * into b from mark_batches where id = new.batch_id;
  if not found then raise exception 'Marks sheet not found.'; end if;
  if b.status = 'LOCKED' then raise exception 'Exam is locked.'; end if;
  if b.status <> 'DRAFT' and not app.is_privileged() then
    raise exception 'These marks are already submitted. Ask the administrator to return them for editing.';
  end if;
  if b.class_subject_id is distinct from new.class_subject_id or b.examination_id <> new.examination_id then
    raise exception 'These marks do not belong to this sheet.';
  end if;
  if not exists (select 1 from student_class_enrollments e
                 where e.id = new.enrollment_id and e.class_section_id = b.class_section_id and e.status = 'ACTIVE') then
    raise exception 'Student is not enrolled in this class section.';
  end if;
  if not app.is_privileged() then
    select subject_group_id into grp from class_subjects where id = new.class_subject_id;
    if grp is not null and not exists (select 1 from student_subject_choices c
                                       where c.enrollment_id = new.enrollment_id and c.class_subject_id = new.class_subject_id) then
      raise exception 'This student has not taken this subject.';
    end if;
  end if;
  mx := app.component_max(new.examination_id, new.class_subject_id, new.component_id);
  if mx is null then raise exception 'This assessment component does not apply to the subject.'; end if;
  if new.value is not null and new.value > mx then
    raise exception 'Marks cannot exceed maximum marks (%).', mx;
  end if;
  new.entered_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

do $$ begin
  if exists (select 1 from teacher_assignments where role = 'CLASS' group by class_section_id having count(*) > 1) then
    raise notice 'Skipped the one-class-teacher-per-section index: some sections already have more than one class teacher. Remove the extras in Admin → Teacher assignments, then re-run this file.';
  else
    create unique index if not exists teacher_assignments_one_class_teacher on teacher_assignments (class_section_id) where role = 'CLASS';
  end if;
end $$;
