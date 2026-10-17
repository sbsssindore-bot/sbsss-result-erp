-- 0013 · Repair exact class-subject combinations for multi-subject teachers.
-- This migration only resets SUBJECT rows for the two named teachers in the active
-- academic session. CLASS (class-teacher) assignments and all other teachers are untouched.
-- Each requested class-subject pair is inserted explicitly; no class × subject cross-product.

create temporary table _desired_teacher_subjects (
  employee_id text not null,
  class_roman text not null,
  subject_key text not null
);

insert into _desired_teacher_subjects (employee_id, class_roman, subject_key) values
  ('T025', 'VI',   'social_science'),
  ('T025', 'VII',  'social_science'),
  ('T025', 'VIII', 'social_science'),
  ('T025', 'VI',   'hindi'),
  ('T025', 'VI',   'gk'),
  ('T011', 'IV',   'mathematics'),
  ('T011', 'V',    'mathematics'),
  ('T011', 'II',   'evs'),
  ('T011', 'III',  'evs');

do $$
declare
  active_session uuid;
  missing_pair text;
begin
  select id into active_session
  from academic_sessions
  where status = 'ACTIVE'
  order by created_at desc nulls last
  limit 1;

  if active_session is null then
    raise exception 'No active academic session found; teacher assignments were not changed.';
  end if;

  if not exists (select 1 from teachers where employee_id = 'T025')
     or not exists (select 1 from teachers where employee_id = 'T011') then
    raise exception 'Teacher T025 or T011 was not found; teacher assignments were not changed.';
  end if;

  -- Validate all expected class-subject pairs before deleting anything.
  select d.employee_id || ' / Class ' || d.class_roman || ' / ' || d.subject_key
    into missing_pair
  from _desired_teacher_subjects d
  where not exists (
    select 1
    from teachers t
    join class_sections cs on cs.session_id = active_session and cs.status = 'ACTIVE'
    join classes cl on cl.id = cs.class_id
    join class_subjects csub on csub.session_id = active_session
      and csub.class_id = cs.class_id and csub.status = 'ACTIVE' and csub.kind = 'MARKS'
    join subjects s on s.id = csub.subject_id
    where t.employee_id = d.employee_id
      and upper(replace(trim(cl.roman), '.', '')) = d.class_roman
      and (
        (d.subject_key = 'social_science' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('social science', 'social studies')
          or lower(trim(s.name)) in ('social science', 'social studies')
        ))
        or (d.subject_key = 'hindi' and (
          lower(trim(coalesce(csub.display_label, ''))) = 'hindi' or lower(trim(s.name)) = 'hindi'
        ))
        or (d.subject_key = 'gk' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('gk', 'general knowledge')
          or lower(trim(s.name)) in ('gk', 'general knowledge')
        ))
        or (d.subject_key = 'mathematics' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('math', 'maths', 'mathematics')
          or lower(trim(s.name)) in ('math', 'maths', 'mathematics')
        ))
        or (d.subject_key = 'evs' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('evs', 'environmental studies', 'environment studies')
          or lower(trim(s.name)) in ('evs', 'environmental studies', 'environment studies')
        ))
      )
  )
  limit 1;

  if missing_pair is not null then
    raise exception 'Cannot safely repair teacher assignments: missing active class/subject pair (%). No assignments were changed.', missing_pair;
  end if;

  -- Remove only subject-teacher rows for these two teachers in the active session.
  -- Their class-teacher roles are intentionally preserved.
  delete from teacher_assignments ta
  using teachers t
  where ta.teacher_id = t.id
    and ta.session_id = active_session
    and ta.role = 'SUBJECT'
    and t.employee_id in ('T025', 'T011');

  insert into teacher_assignments (session_id, teacher_id, class_section_id, class_subject_id, role)
  select distinct active_session, t.id, cs.id, csub.id, 'SUBJECT'
  from _desired_teacher_subjects d
  join teachers t on t.employee_id = d.employee_id
  join class_sections cs on cs.session_id = active_session and cs.status = 'ACTIVE'
  join classes cl on cl.id = cs.class_id
    and upper(replace(trim(cl.roman), '.', '')) = d.class_roman
  join class_subjects csub on csub.session_id = active_session
    and csub.class_id = cs.class_id and csub.status = 'ACTIVE' and csub.kind = 'MARKS'
  join subjects s on s.id = csub.subject_id
  where
    (d.subject_key = 'social_science' and (
      lower(trim(coalesce(csub.display_label, ''))) in ('social science', 'social studies')
      or lower(trim(s.name)) in ('social science', 'social studies')
    ))
    or (d.subject_key = 'hindi' and (
      lower(trim(coalesce(csub.display_label, ''))) = 'hindi' or lower(trim(s.name)) = 'hindi'
    ))
    or (d.subject_key = 'gk' and (
      lower(trim(coalesce(csub.display_label, ''))) in ('gk', 'general knowledge')
      or lower(trim(s.name)) in ('gk', 'general knowledge')
    ))
    or (d.subject_key = 'mathematics' and (
      lower(trim(coalesce(csub.display_label, ''))) in ('math', 'maths', 'mathematics')
      or lower(trim(s.name)) in ('math', 'maths', 'mathematics')
    ))
    or (d.subject_key = 'evs' and (
      lower(trim(coalesce(csub.display_label, ''))) in ('evs', 'environmental studies', 'environment studies')
      or lower(trim(s.name)) in ('evs', 'environmental studies', 'environment studies')
    ));

  -- Postcondition: every requested combination must now exist.
  select d.employee_id || ' / Class ' || d.class_roman || ' / ' || d.subject_key
    into missing_pair
  from _desired_teacher_subjects d
  where not exists (
    select 1
    from teacher_assignments ta
    join teachers t on t.id = ta.teacher_id
    join class_sections cs on cs.id = ta.class_section_id
    join classes cl on cl.id = cs.class_id
    join class_subjects csub on csub.id = ta.class_subject_id
    join subjects s on s.id = csub.subject_id
    where ta.session_id = active_session
      and ta.role = 'SUBJECT'
      and t.employee_id = d.employee_id
      and upper(replace(trim(cl.roman), '.', '')) = d.class_roman
      and (
        (d.subject_key = 'social_science' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('social science', 'social studies')
          or lower(trim(s.name)) in ('social science', 'social studies')
        ))
        or (d.subject_key = 'hindi' and (
          lower(trim(coalesce(csub.display_label, ''))) = 'hindi' or lower(trim(s.name)) = 'hindi'
        ))
        or (d.subject_key = 'gk' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('gk', 'general knowledge')
          or lower(trim(s.name)) in ('gk', 'general knowledge')
        ))
        or (d.subject_key = 'mathematics' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('math', 'maths', 'mathematics')
          or lower(trim(s.name)) in ('math', 'maths', 'mathematics')
        ))
        or (d.subject_key = 'evs' and (
          lower(trim(coalesce(csub.display_label, ''))) in ('evs', 'environmental studies', 'environment studies')
          or lower(trim(s.name)) in ('evs', 'environmental studies', 'environment studies')
        ))
      )
  )
  limit 1;

  if missing_pair is not null then
    raise exception 'Teacher assignment repair did not complete: missing pair (%). Transaction rolled back.', missing_pair;
  end if;
end $$;
