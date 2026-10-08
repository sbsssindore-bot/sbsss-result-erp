-- =====================================================================
-- 0005 — separate Teacher import (master data) and Teacher-Assignment import
-- Safe to run whether or not an older commit_import_teachers exists.
-- Assignments reference: teacher_id, session_id (via class_sections.session_id),
-- class_id + section_id (via class_sections) and subject_id (via class_subjects).
-- =====================================================================
alter table teachers add column if not exists login_id text;
create unique index if not exists teachers_login_id_uq on teachers (lower(login_id)) where login_id is not null;

alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('STUDENTS', 'TEACHERS', 'ASSIGNMENTS'));
alter table import_batches drop constraint if exists import_batches_mode_check;
alter table import_batches add constraint import_batches_mode_check check (mode in ('CREATE', 'UPDATE', 'SKIP', 'ADD', 'REPLACE'));

drop function if exists public.commit_import_teachers(uuid, text);

-- ---------- Teachers (master data only; teachers are stored once, not per session) ----------
create function public.commit_import_teachers(p_batch uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b import_batches; r jsonb; tid uuid; created int := 0; updated int := 0; skipped int := 0; st record_status;
begin
  if not app.is_admin() then raise exception 'Only administrators can import data.'; end if;
  select * into b from import_batches where id = p_batch and kind = 'TEACHERS' for update;
  if not found then raise exception 'Import not found.'; end if;
  if b.status <> 'PREVIEW' then raise exception 'This import has already been processed.'; end if;
  if p_mode not in ('CREATE', 'UPDATE') then raise exception 'Choose how to handle teachers that already exist.'; end if;

  for r in select value from jsonb_array_elements(b.rows) loop
    if coalesce(r ->> '_status', '') <> 'OK' then continue; end if;
    st := case when upper(coalesce(r ->> 'status', '')) = 'INACTIVE' then 'INACTIVE' else 'ACTIVE' end;
    select id into tid from teachers where employee_id = r ->> 'employee_id';
    if tid is null then
      insert into teachers (employee_id, name, email, mobile, designation, department, login_id, status)
      values (r ->> 'employee_id', r ->> 'name', nullif(lower(r ->> 'email'), ''), nullif(r ->> 'mobile', ''), nullif(r ->> 'designation', ''),
              nullif(r ->> 'department', ''), nullif(r ->> 'login_id', ''), st)
      returning id into tid;
      created := created + 1;
    elsif p_mode = 'UPDATE' then
      update teachers set name = coalesce(nullif(r ->> 'name', ''), name),
             email = coalesce(nullif(lower(r ->> 'email'), ''), email), mobile = coalesce(nullif(r ->> 'mobile', ''), mobile),
             designation = coalesce(nullif(r ->> 'designation', ''), designation), department = coalesce(nullif(r ->> 'department', ''), department),
             login_id = coalesce(nullif(r ->> 'login_id', ''), login_id), status = st
       where id = tid;
      updated := updated + 1;
    else
      skipped := skipped + 1; continue;
    end if;
    -- link to an existing sign-in (if the person already has an account with this email)
    update teachers t set profile_id = p.id from profiles p
     where t.id = tid and t.profile_id is null and t.email is not null and lower(p.email) = lower(t.email);
  end loop;

  update import_batches set status = 'COMMITTED', mode = p_mode,
         summary = summary || jsonb_build_object('result', jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped))
   where id = p_batch;
  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
end $$;

-- ---------- Assignments ----------
create function public.commit_import_assignments(p_batch uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b import_batches; r jsonb; tid uuid; sess uuid; cls smallint; sec uuid; strm uuid; cs uuid; csub uuid; role_ assignment_role;
  secname text; strmname text; subj text; conflicts uuid[]; n int;
  added int := 0; existing int := 0; skipped int := 0; replaced int := 0;
begin
  if not app.is_admin() then raise exception 'Only administrators can import data.'; end if;
  select * into b from import_batches where id = p_batch and kind = 'ASSIGNMENTS' for update;
  if not found then raise exception 'Import not found.'; end if;
  if b.status <> 'PREVIEW' then raise exception 'This import has already been processed.'; end if;
  if p_mode not in ('SKIP', 'ADD', 'REPLACE') then raise exception 'Choose what to do when another teacher is already assigned.'; end if;

  for r in select value from jsonb_array_elements(b.rows) loop
    if coalesce(r ->> '_status', '') <> 'OK' then continue; end if;
    select id into tid from teachers where employee_id = r ->> 'employee_id';
    if tid is null then raise exception 'Teacher ID % was not found.', r ->> 'employee_id'; end if;
    select id into sess from academic_sessions
     where (nullif(r ->> 'academic_session', '') is null and status = 'ACTIVE')
        or replace(label, '–', '-') = replace(r ->> 'academic_session', '–', '-') limit 1;
    if sess is null then raise exception 'Academic session % was not found.', r ->> 'academic_session'; end if;

    cls := (r ->> 'class_id')::smallint;
    secname := nullif(btrim(r ->> 'section'), ''); strmname := nullif(btrim(r ->> 'stream'), '');
    sec := null; strm := null;
    if secname is not null then select id into sec from sections where name = secname; end if;
    if strmname is not null then select id into strm from streams where lower(name) = lower(strmname); end if;
    select id into cs from class_sections
     where session_id = sess and class_id = cls and section_id is not distinct from sec and stream_id is not distinct from strm;
    if cs is null then raise exception 'Class section % does not exist in this session.', r ->> 'class_id'; end if;

    role_ := case when upper(coalesce(r ->> 'role', '')) = 'CLASS' then 'CLASS' else 'SUBJECT' end;
    csub := null;
    if role_ = 'SUBJECT' then
      subj := nullif(btrim(r ->> 'subject'), '');
      select c.id into csub from class_subjects c join subjects s on s.id = c.subject_id
       where c.session_id = sess and c.class_id = cls and c.status = 'ACTIVE'
         and (lower(s.name) = lower(subj) or lower(c.display_label) = lower(subj))
       order by (c.stream_id is not distinct from strm) desc, (c.stream_id is null) desc, c.display_order limit 1;
      if csub is null then raise exception 'Subject % is not offered in this class.', subj; end if;
    end if;

    if exists (select 1 from teacher_assignments where teacher_id = tid and class_section_id = cs and role = role_
                  and class_subject_id is not distinct from csub) then
      existing := existing + 1; continue;
    end if;
    select array_agg(id) into conflicts from teacher_assignments
     where class_section_id = cs and role = role_ and class_subject_id is not distinct from csub and teacher_id <> tid;
    if conflicts is not null then
      if p_mode = 'SKIP' or (p_mode = 'ADD' and role_ = 'CLASS') then skipped := skipped + 1; continue; end if;
      if p_mode = 'REPLACE' then
        delete from teacher_assignments where id = any (conflicts);
        get diagnostics n = row_count; replaced := replaced + n;
      end if;
    end if;
    insert into teacher_assignments (session_id, teacher_id, class_section_id, class_subject_id, role)
    values (sess, tid, cs, csub, role_);
    added := added + 1;
  end loop;

  update import_batches set status = 'COMMITTED', mode = p_mode,
         summary = summary || jsonb_build_object('result', jsonb_build_object('added', added, 'already_assigned', existing, 'skipped_other_teacher', skipped, 'replaced', replaced))
   where id = p_batch;
  return jsonb_build_object('added', added, 'already_assigned', existing, 'skipped_other_teacher', skipped, 'replaced', replaced);
end $$;

revoke execute on function public.commit_import_teachers(uuid, text), public.commit_import_assignments(uuid, text) from public, anon;
grant execute on function public.commit_import_teachers(uuid, text), public.commit_import_assignments(uuid, text) to authenticated;
