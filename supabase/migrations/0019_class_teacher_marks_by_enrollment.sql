-- Make class-teacher marks visibility depend on the student's active enrollment
-- and the teacher's CLASS assignment, rather than marks.batch_id. This avoids
-- hiding otherwise valid marks when legacy rows reference a stale batch record.
drop policy if exists class_teacher_read_subject_marks on public.marks;

create policy class_teacher_read_subject_marks on public.marks
for select to authenticated
using (
  app.is_admin()
  or exists (
    select 1
    from public.student_class_enrollments e
    join public.class_sections section
      on section.id = e.class_section_id
     and section.session_id = e.session_id
    join public.teacher_assignments a
      on a.class_section_id = section.id
     and a.teacher_id = app.my_teacher_id()
     and a.role = 'CLASS'
    join public.examinations exam
      on exam.id = marks.examination_id
     and exam.session_id = e.session_id
    join public.class_subjects subject
      on subject.id = marks.class_subject_id
     and subject.session_id = e.session_id
     and subject.class_id = section.class_id
    where e.id = marks.enrollment_id
      and e.status = 'ACTIVE'
      and section.status = 'ACTIVE'
      and subject.kind = 'MARKS'
  )
);
