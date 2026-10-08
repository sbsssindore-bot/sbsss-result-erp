-- =====================================================================
-- SBSSS Result ERP — 0001 core schema (PostgreSQL / Supabase)
-- Relational model: Session → Class → Section/Stream → Enrollment → Student
--                   Examination → Components → Marks → Report card
-- Student master is stored once; enrollments carry the per-session placement.
-- =====================================================================
create schema if not exists app;

create type entry_status   as enum ('DRAFT','SUBMITTED','VERIFIED','LOCKED');
create type record_status  as enum ('ACTIVE','INACTIVE');
create type exam_type      as enum ('TERM','ANNUAL','OTHER');
create type subject_kind   as enum ('MARKS','GRADE');
create type assignment_role as enum ('SUBJECT','CLASS');
create type annual_method  as enum ('SUM','WEIGHTED','SELECTED','BEST_OF','FORMULA');

-- ---------- identity ----------
create table roles (key text primary key, name text not null);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'TEACHER' references roles(key),
  full_name text,
  email text,
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on profiles (lower(email));

-- ---------- school + sessions ----------
create table academic_sessions (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,                         -- '2026-27'
  start_date date, end_date date,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','CLOSED')),
  created_at timestamptz not null default now()
);
create unique index one_active_session on academic_sessions ((true)) where status = 'ACTIVE';

create table school_settings (
  id boolean primary key default true check (id),
  school_name text not null,
  address text, phone text, email text, principal_name text,
  logo_path text,                                     -- Supabase Storage object path
  issue_date date,
  signature_labels jsonb not null default
    '{"class_teacher":"Class Teacher Signature","parent":"Parent / Guardian Signature","principal":"Principal Signature"}',
  watermark jsonb not null default '{"enabled":true,"opacity":0.08,"position":"center","size":60}',
  active_session_id uuid references academic_sessions(id)
);

-- ---------- classes / sections / streams ----------
create table classes (                                -- standard ids 1..12
  id smallint primary key check (id between 1 and 12),
  name text not null,                                 -- 'Class VI'
  roman text not null
);
create table sections (id uuid primary key default gen_random_uuid(), name text not null unique);
create table streams  (id uuid primary key default gen_random_uuid(), name text not null unique, status record_status not null default 'ACTIVE');

-- a teaching group inside one session: e.g. 2026-27 / Class VI / A, or Class XI / Science (/ A)
create table class_sections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references academic_sessions(id),
  class_id smallint not null references classes(id),
  section_id uuid references sections(id),
  stream_id uuid references streams(id),
  label text not null,                                -- 'VI-A', 'XI Science-A'
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  check (section_id is not null or stream_id is not null)
);
create unique index class_sections_uq on class_sections
  (session_id, class_id,
   coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(stream_id,  '00000000-0000-0000-0000-000000000000'::uuid));
create index class_sections_session_idx on class_sections (session_id, class_id);

-- ---------- people ----------
create table students (
  id uuid primary key default gen_random_uuid(),
  scholar_number text not null unique,
  student_code text unique,
  admission_number text,
  name text not null,
  dob date,
  gender text check (gender in ('M','F','O')),
  father_name text, mother_name text, mobile text, address text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ALUMNI','TRANSFERRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx    on students (lower(name));
create index students_father_idx  on students (lower(father_name));

create table student_class_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  session_id uuid not null references academic_sessions(id),
  class_section_id uuid not null references class_sections(id),
  roll_number int check (roll_number > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PROMOTED','LEFT','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, session_id)
);
create unique index enrollment_roll_uq on student_class_enrollments (class_section_id, roll_number)
  where status = 'ACTIVE' and roll_number is not null;
create index enrollment_cs_idx on student_class_enrollments (class_section_id);
create index enrollment_session_idx on student_class_enrollments (session_id);

create table teachers (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  name text not null,
  email text, mobile text, designation text, department text,
  profile_id uuid unique references profiles(id),     -- linked automatically when the auth user is created
  status record_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index teachers_email_uq on teachers (lower(email)) where email is not null;

-- ---------- subjects ----------
create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  kind subject_kind not null default 'MARKS',
  status record_status not null default 'ACTIVE'
);
create unique index subjects_uq on subjects (lower(name), coalesce(code, ''));

create table subject_groups (                         -- report-card slots (XI–XII): one row prints one of several subjects
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  slot_no smallint not null,
  label text not null,
  unique (template_code, slot_no)
);

create table class_subjects (                         -- subjects offered to a class in one session
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references academic_sessions(id),
  class_id smallint not null references classes(id),
  subject_id uuid not null references subjects(id),
  stream_id uuid references streams(id),
  subject_group_id uuid references subject_groups(id),
  display_label text not null,                        -- e.g. 'English (R1)'
  kind subject_kind not null default 'MARKS',
  include_in_overall boolean not null default true,
  pass_required boolean not null default true,
  display_order int not null default 0,
  status record_status not null default 'ACTIVE'
);
create unique index class_subjects_uq on class_subjects
  (session_id, class_id, subject_id, coalesce(stream_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index class_subjects_idx on class_subjects (session_id, class_id);

create table student_subject_choices (                -- XI–XII: which subject fills each slot
  enrollment_id uuid not null references student_class_enrollments(id) on delete cascade,
  subject_group_id uuid not null references subject_groups(id),
  class_subject_id uuid not null references class_subjects(id),
  primary key (enrollment_id, subject_group_id)
);

create table teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references academic_sessions(id),
  teacher_id uuid not null references teachers(id),
  class_section_id uuid not null references class_sections(id),
  class_subject_id uuid references class_subjects(id),
  role assignment_role not null default 'SUBJECT',
  created_at timestamptz not null default now(),
  check ((role = 'SUBJECT' and class_subject_id is not null) or (role = 'CLASS' and class_subject_id is null))
);
create unique index teacher_assignments_uq on teacher_assignments
  (teacher_id, class_section_id, coalesce(class_subject_id, '00000000-0000-0000-0000-000000000000'::uuid), role);
create index teacher_assignments_teacher_idx on teacher_assignments (teacher_id, session_id);

-- ---------- grading + results ----------
create table grade_scales (id uuid primary key default gen_random_uuid(), name text not null, is_default boolean not null default false);
create unique index one_default_scale on grade_scales ((true)) where is_default;
create table grade_scale_bands (
  id uuid primary key default gen_random_uuid(),
  scale_id uuid not null references grade_scales(id) on delete cascade,
  grade text not null,
  min_percentage numeric(5,2) not null check (min_percentage between 0 and 100),
  sort_order int not null default 0,
  unique (scale_id, min_percentage)
);
create table result_statuses (code text primary key, label text not null, sort_order int not null default 0);
create table result_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule jsonb not null,                                -- {"mode":"manual"} or {"mode":"auto",...}
  is_default boolean not null default false
);
create table co_grade_values (value text primary key, label text, sort_order int not null default 0);

-- ---------- examinations ----------
create table report_card_templates (
  code text primary key,                              -- 'A'..'F'
  name text not null,
  min_class smallint not null, max_class smallint not null,
  layout jsonb not null
);

create table examinations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references academic_sessions(id),
  name text not null,                                 -- 'Term I'
  display_name text,                                  -- printed in header
  term_label text,                                    -- 'Term - I' printed in "Academic Term"
  type exam_type not null default 'TERM',
  sequence int not null default 1,
  status text not null default 'OPEN' check (status in ('DRAFT','OPEN','CLOSED')),
  grade_scale_id uuid references grade_scales(id),
  result_rule_id uuid references result_rules(id),
  created_at timestamptz not null default now(),
  unique (session_id, name)
);
create table exam_components (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references examinations(id) on delete cascade,
  template_code text not null references report_card_templates(code),
  code text not null,
  label text not null,
  max_marks numeric(6,2) not null check (max_marks >= 0),
  weightage numeric(6,3) not null default 1,
  allow_decimal boolean not null default true,
  display_order int not null default 0,
  unique (examination_id, template_code, code)
);
create table exam_component_limits (                  -- per-subject overrides (XI–XII 30/70 vs 20/80)
  class_subject_id uuid not null references class_subjects(id) on delete cascade,
  component_id uuid not null references exam_components(id) on delete cascade,
  max_marks numeric(6,2) check (max_marks >= 0),
  is_applicable boolean not null default true,
  primary key (class_subject_id, component_id)
);
create table annual_rules (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null unique references examinations(id) on delete cascade,
  method annual_method not null,
  formula text,
  config jsonb not null default '{}'
);
create table annual_rule_sources (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references annual_rules(id) on delete cascade,
  source_examination_id uuid not null references examinations(id),
  weight numeric(6,3) not null default 1,
  component_code text
);

-- ---------- marks workflow ----------
create table mark_batches (                           -- one sheet: exam × class-section × subject (subject null = class-level sheet)
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references examinations(id),
  class_section_id uuid not null references class_sections(id),
  class_subject_id uuid references class_subjects(id),
  status entry_status not null default 'DRAFT',
  submitted_by uuid, submitted_at timestamptz,
  verified_by uuid,  verified_at timestamptz,
  locked_by uuid,    locked_at timestamptz,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index mark_batches_uq on mark_batches
  (examination_id, class_section_id, coalesce(class_subject_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table marks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references mark_batches(id) on delete cascade,
  enrollment_id uuid not null references student_class_enrollments(id),
  examination_id uuid not null references examinations(id),
  class_subject_id uuid not null references class_subjects(id),
  component_id uuid not null references exam_components(id),
  value numeric(6,2) check (value >= 0),
  is_absent boolean not null default false,
  entered_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, examination_id, class_subject_id, component_id),
  check (not (is_absent and value is not null))
);
create index marks_batch_idx on marks (batch_id);
create index marks_enrollment_idx on marks (enrollment_id, examination_id);

create table co_scholastic_areas (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references academic_sessions(id),
  class_id smallint not null references classes(id),
  name text not null,
  display_label text,
  kind text not null default 'ACTIVITY' check (kind in ('ACTIVITY','SUBJECT_GRADE')),
  display_order int not null default 0,
  unique (session_id, class_id, name)
);
create table co_scholastic_marks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references mark_batches(id) on delete cascade,
  enrollment_id uuid not null references student_class_enrollments(id),
  examination_id uuid not null references examinations(id),
  area_id uuid not null references co_scholastic_areas(id),
  grade text not null references co_grade_values(value),
  entered_by uuid,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, examination_id, area_id)
);
create table attendance (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references mark_batches(id) on delete cascade,
  enrollment_id uuid not null references student_class_enrollments(id),
  examination_id uuid not null references examinations(id),
  working_days numeric(5,1) check (working_days >= 0),
  present_days numeric(5,1) check (present_days >= 0),
  absent_days numeric(5,1) generated always as (working_days - present_days) stored,
  attendance_pct numeric(5,2) generated always as
    (case when working_days > 0 then round(present_days * 100 / working_days, 2) end) stored,
  entered_by uuid,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, examination_id),
  check (working_days is null or present_days is null or present_days <= working_days)
);
create table report_remarks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references mark_batches(id) on delete cascade,
  enrollment_id uuid not null references student_class_enrollments(id),
  examination_id uuid not null references examinations(id),
  remarks text check (char_length(remarks) <= 500),
  result_status text references result_statuses(code),  -- manual status when no automatic rule applies
  entered_by uuid,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, examination_id)
);

-- ---------- report cards, imports, audit ----------
create table report_card_configurations (
  template_code text primary key references report_card_templates(code),
  config jsonb not null default '{}'                  -- per-template overrides (watermark, labels)
);
create table report_cards (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references student_class_enrollments(id),
  examination_id uuid not null references examinations(id),
  template_code text not null references report_card_templates(code),
  snapshot jsonb not null,                            -- data used to render; reprints match what was issued
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED')),
  issue_date date,
  pdf_path text,
  generated_by uuid, generated_at timestamptz not null default now(),
  unique (enrollment_id, examination_id)
);
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('STUDENTS','TEACHERS')),
  file_name text,
  mode text check (mode in ('CREATE','UPDATE','SKIP')),
  status text not null default 'PREVIEW' check (status in ('PREVIEW','COMMITTED','FAILED')),
  summary jsonb not null default '{}',
  errors jsonb not null default '[]',
  created_by uuid,
  created_at timestamptz not null default now()
);
create table audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid, actor_email text,
  action text not null,                               -- INSERT / UPDATE / DELETE
  table_name text not null,
  row_id text,
  old_value jsonb, new_value jsonb,
  context jsonb,
  reason text
);
create index audit_table_idx on audit_logs (table_name, created_at desc);
create index audit_actor_idx on audit_logs (actor_id, created_at desc);

alter table school_settings add constraint school_settings_session_fk foreign key (active_session_id) references academic_sessions(id);

-- =====================================================================
-- Helper functions (security definer, fixed search_path)
-- =====================================================================
create function app.user_role() returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status = 'ACTIVE' $$;

create function app.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(app.user_role() = 'ADMIN', false) $$;

create function app.is_active_user() returns boolean language sql stable security definer set search_path = public as
$$ select app.user_role() is not null $$;

create function app.is_privileged() returns boolean language sql stable as
$$ select app.is_admin() or coalesce(current_setting('role', true), '') = 'service_role' $$;

create function app.my_teacher_id() returns uuid language sql stable security definer set search_path = public as
$$ select id from teachers where profile_id = auth.uid() and status = 'ACTIVE' $$;

create function app.my_class_sections() returns setof uuid language sql stable security definer set search_path = public as
$$ select distinct class_section_id from teacher_assignments where teacher_id = app.my_teacher_id() $$;

create function app.teaches_batch(p_batch uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from mark_batches b
     join teacher_assignments a on a.class_section_id = b.class_section_id and a.teacher_id = app.my_teacher_id()
     where b.id = p_batch
       and ((b.class_subject_id is not null and a.role = 'SUBJECT' and a.class_subject_id = b.class_subject_id)
         or (b.class_subject_id is null     and a.role = 'CLASS'))) $$;

create function app.can_open_batch(p_exam uuid, p_cs uuid, p_subject uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from teacher_assignments a
     where a.teacher_id = app.my_teacher_id() and a.class_section_id = p_cs
       and ((p_subject is not null and a.role = 'SUBJECT' and a.class_subject_id = p_subject)
         or (p_subject is null     and a.role = 'CLASS'))) $$;

create function app.batch_status(p_batch uuid) returns entry_status language sql stable security definer set search_path = public as
$$ select status from mark_batches where id = p_batch $$;

create function app.component_max(p_exam uuid, p_cs uuid, p_comp uuid) returns numeric language sql stable security definer set search_path = public as
$$ select coalesce(l.max_marks, c.max_marks)
   from exam_components c
   left join exam_component_limits l on l.component_id = c.id and l.class_subject_id = p_cs
   where c.id = p_comp and c.examination_id = p_exam and coalesce(l.is_applicable, true) $$;

-- ---------- normalisation helpers used by the import preview ----------
create function app.normalize_class(t text) returns smallint language plpgsql immutable as $$
declare s text; n int;
begin
  if t is null then return null; end if;
  s := lower(btrim(t));
  s := regexp_replace(s, '(class|grade|standard|std|cl)\.?', '', 'g');
  s := regexp_replace(s, '[^a-z0-9]', '', 'g');
  s := regexp_replace(s, '^(\d+)(st|nd|rd|th)$', '\1');
  if s ~ '^\d+$' then
    n := s::int;
    if n between 1 and 12 then return n::smallint; end if;
    return null;
  end if;
  return case s when 'i' then 1 when 'ii' then 2 when 'iii' then 3 when 'iv' then 4 when 'v' then 5
                when 'vi' then 6 when 'vii' then 7 when 'viii' then 8 when 'ix' then 9 when 'x' then 10
                when 'xi' then 11 when 'xii' then 12 else null end;
end $$;

create function app.normalize_section(t text) returns text language plpgsql immutable as $$
declare s text;
begin
  if t is null then return null; end if;
  s := upper(btrim(t));
  s := regexp_replace(s, 'SECTION|SEC', '', 'g');
  s := regexp_replace(s, '[^A-Z0-9]', '', 'g');
  return nullif(s, '');
end $$;

create function app.normalize_stream(t text) returns text language plpgsql immutable as $$
declare s text;
begin
  if t is null then return null; end if;
  s := lower(btrim(t));
  if s = '' then return null; end if;
  if s like 'sci%' then return 'Science'; end if;
  if s like 'com%' then return 'Commerce'; end if;
  if s like 'art%' or s like 'human%' then return 'Arts'; end if;
  return initcap(btrim(t));
end $$;

-- =====================================================================
-- Triggers
-- =====================================================================
create function app.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;

create trigger touch_profiles    before update on profiles    for each row execute function app.touch_updated_at();
create trigger touch_students    before update on students    for each row execute function app.touch_updated_at();
create trigger touch_enrollments before update on student_class_enrollments for each row execute function app.touch_updated_at();
create trigger touch_teachers    before update on teachers    for each row execute function app.touch_updated_at();
create trigger touch_batches     before update on mark_batches for each row execute function app.touch_updated_at();

-- new auth user → profile; link to an imported teacher by e-mail
create function app.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), 'TEACHER')
  on conflict (id) do nothing;
  update teachers set profile_id = new.id
   where profile_id is null and email is not null and lower(email) = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- enrollment must sit in a class-section of the same session
create function app.check_enrollment() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from class_sections cs where cs.id = new.class_section_id and cs.session_id = new.session_id) then
    raise exception 'The class section does not belong to this academic session.';
  end if;
  return new;
end $$;
create trigger enrollment_check before insert or update on student_class_enrollments for each row execute function app.check_enrollment();

-- server-side marks validation (authoritative, regardless of client)
create function app.check_marks() returns trigger language plpgsql as $$
declare b mark_batches; mx numeric;
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
  mx := app.component_max(new.examination_id, new.class_subject_id, new.component_id);
  if mx is null then raise exception 'This assessment component does not apply to the subject.'; end if;
  if new.value is not null and new.value > mx then
    raise exception 'Marks cannot exceed maximum marks (%).', mx;
  end if;
  new.entered_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger marks_check before insert or update on marks for each row execute function app.check_marks();

-- same sheet rules for class-level entries (co-scholastic grades, attendance, remarks)
create function app.check_class_entry() returns trigger language plpgsql as $$
declare b mark_batches;
begin
  select * into b from mark_batches where id = new.batch_id;
  if not found then raise exception 'Entry sheet not found.'; end if;
  if b.status = 'LOCKED' then raise exception 'Exam is locked.'; end if;
  if b.status <> 'DRAFT' and not app.is_privileged() then
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
create trigger co_check  before insert or update on co_scholastic_marks for each row execute function app.check_class_entry();
create trigger att_check before insert or update on attendance          for each row execute function app.check_class_entry();
create trigger rem_check before insert or update on report_remarks      for each row execute function app.check_class_entry();

create function app.check_co_area() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from co_scholastic_areas a
                 join mark_batches b on b.id = new.batch_id
                 join class_sections cs on cs.id = b.class_section_id
                 where a.id = new.area_id and a.class_id = cs.class_id and a.session_id = cs.session_id) then
    raise exception 'This activity does not belong to the class.';
  end if;
  return new;
end $$;
create trigger co_area_check before insert or update on co_scholastic_marks for each row execute function app.check_co_area();

-- workflow: DRAFT → SUBMITTED (teacher or admin) → VERIFIED → LOCKED (admin); unlocking needs a reason
create function app.check_batch_transition() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if app.is_privileged() then
      if new.status = 'DRAFT' and coalesce(btrim(new.unlock_reason), '') = '' then
        raise exception 'A reason is required to unlock or return marks.';
      end if;
      if new.status = 'SUBMITTED' then new.submitted_by := auth.uid(); new.submitted_at := now(); end if;
      if new.status = 'VERIFIED'  then new.verified_by  := auth.uid(); new.verified_at  := now(); end if;
      if new.status = 'LOCKED'    then new.locked_by    := auth.uid(); new.locked_at    := now(); end if;
    else
      if not (old.status = 'DRAFT' and new.status = 'SUBMITTED') then
        raise exception 'Teachers can only submit draft marks.';
      end if;
      new.submitted_by := auth.uid(); new.submitted_at := now();
    end if;
  end if;
  if tg_op = 'UPDATE' and not app.is_privileged() then
    new.examination_id := old.examination_id; new.class_section_id := old.class_section_id;
    new.class_subject_id := old.class_subject_id; new.unlock_reason := old.unlock_reason;
    new.verified_by := old.verified_by; new.verified_at := old.verified_at;
    new.locked_by := old.locked_by; new.locked_at := old.locked_at;
  end if;
  return new;
end $$;
create trigger batch_transition before insert or update on mark_batches for each row execute function app.check_batch_transition();

-- audit trail (who / what / old / new / when)
create function app.audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; ctx jsonb; rid text; skip text[] := array['updated_at','entered_by','created_at'];
begin
  if tg_op = 'INSERT' then n := to_jsonb(new); rid := n ->> 'id';
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new); rid := n ->> 'id';
    if (o - skip) = (n - skip) then return new; end if;
  else o := to_jsonb(old); rid := o ->> 'id'; end if;

  if tg_table_name = 'marks' then
    select jsonb_build_object('student', s.name, 'scholar_number', s.scholar_number, 'subject', cs.display_label,
                              'component', c.code, 'exam', x.name)
      into ctx
      from student_class_enrollments e join students s on s.id = e.student_id,
           class_subjects cs, exam_components c, examinations x
     where e.id = coalesce(n ->> 'enrollment_id', o ->> 'enrollment_id')::uuid
       and cs.id = coalesce(n ->> 'class_subject_id', o ->> 'class_subject_id')::uuid
       and c.id = coalesce(n ->> 'component_id', o ->> 'component_id')::uuid
       and x.id = coalesce(n ->> 'examination_id', o ->> 'examination_id')::uuid;
  elsif tg_table_name = 'mark_batches' then
    select jsonb_build_object('class', cs.label, 'subject', sub.display_label, 'exam', x.name)
      into ctx
      from class_sections cs join mark_batches b on b.class_section_id = cs.id
      left join class_subjects sub on sub.id = b.class_subject_id
      join examinations x on x.id = b.examination_id
     where b.id = (coalesce(n, o) ->> 'id')::uuid;
  end if;

  insert into audit_logs (actor_id, actor_email, action, table_name, row_id, old_value, new_value, context, reason)
  values (auth.uid(), (select email from profiles where id = auth.uid()), tg_op, tg_table_name, rid, o, n, ctx,
          case when tg_table_name = 'mark_batches' then n ->> 'unlock_reason' end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['marks','mark_batches','co_scholastic_marks','attendance','report_remarks','students',
                           'student_class_enrollments','teacher_assignments','teachers','profiles','grade_scale_bands',
                           'exam_components','exam_component_limits','examinations','class_subjects','school_settings']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function app.audit_row()', t);
  end loop;
end $$;
