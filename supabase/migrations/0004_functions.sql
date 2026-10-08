-- =====================================================================
-- SBSSS Result ERP — 0004 admin functions (import commit, exam clone, sessions, promotion)
-- All functions are SECURITY DEFINER but check app.is_admin() first.
-- Imports are transactional: any error rolls back the whole import.
-- =====================================================================
alter table import_batches add column if not exists rows jsonb;

-- ---------- examinations ----------
create function public.clone_examination(p_source uuid, p_name text, p_term_label text, p_rename boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare src examinations; new_id uuid;
begin
  if not app.is_admin() then raise exception 'Only administrators can create examinations.'; end if;
  select * into src from examinations where id = p_source;
  if not found then raise exception 'Source examination not found.'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter an examination name.'; end if;
  if exists (select 1 from examinations where session_id = src.session_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'An examination with this name already exists.';
  end if;
  insert into examinations (session_id, name, display_name, term_label, type, sequence, grade_scale_id, result_rule_id)
  values (src.session_id, btrim(p_name), btrim(p_name), coalesce(nullif(btrim(p_term_label), ''), btrim(p_name)), 'TERM',
          (select coalesce(max(sequence), 0) + 1 from examinations where session_id = src.session_id),
          src.grade_scale_id, src.result_rule_id) returning id into new_id;
  insert into exam_components (examination_id, template_code, code, label, max_marks, weightage, allow_decimal, display_order)
  select new_id, template_code, code,
         case when p_rename then (case label when 'PT-I' then 'PT-II' when 'MT' then 'MT-II' when 'First Term' then 'Second Term' else label end) else label end,
         max_marks, weightage, allow_decimal, display_order
    from exam_components where examination_id = p_source;
  insert into exam_component_limits (class_subject_id, component_id, max_marks, is_applicable)
  select l.class_subject_id, n.id, l.max_marks, l.is_applicable
    from exam_component_limits l
    join exam_components o on o.id = l.component_id and o.examination_id = p_source
    join exam_components n on n.examination_id = new_id and n.template_code = o.template_code and n.code = o.code;
  return new_id;
end $$;

create function public.create_annual_examination(p_session uuid, p_name text, p_term_label text, p_method annual_method, p_sources jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; rid uuid; s jsonb; base examinations;
begin
  if not app.is_admin() then raise exception 'Only administrators can create examinations.'; end if;
  if jsonb_array_length(coalesce(p_sources, '[]')) = 0 then raise exception 'Select at least one examination to combine.'; end if;
  if exists (select 1 from examinations where session_id = p_session and lower(name) = lower(btrim(p_name))) then
    raise exception 'An examination with this name already exists.';
  end if;
  select * into base from examinations where session_id = p_session order by sequence limit 1;
  insert into examinations (session_id, name, display_name, term_label, type, sequence, grade_scale_id, result_rule_id)
  values (p_session, btrim(p_name), btrim(p_name), coalesce(nullif(btrim(p_term_label), ''), btrim(p_name)), 'ANNUAL',
          (select coalesce(max(sequence), 0) + 1 from examinations where session_id = p_session),
          base.grade_scale_id, base.result_rule_id) returning id into new_id;
  insert into annual_rules (examination_id, method) values (new_id, p_method) returning id into rid;
  for s in select value from jsonb_array_elements(p_sources) loop
    insert into annual_rule_sources (rule_id, source_examination_id, weight)
    values (rid, (s ->> 'exam_id')::uuid, coalesce((s ->> 'weight')::numeric, 1));
  end loop;
  return new_id;
end $$;

-- ---------- bulk import: students ----------
create function public.commit_import_students(p_batch uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b import_batches; r jsonb; sess uuid; cls smallint; sec uuid; strm uuid; cs uuid; sid uuid; en uuid;
  secname text; strmname text; roman text; lbl text; exists_student boolean;
  created int := 0; updated int := 0; skipped int := 0; cs_created int := 0; enrolled int := 0;
begin
  if not app.is_admin() then raise exception 'Only administrators can import data.'; end if;
  select * into b from import_batches where id = p_batch and kind = 'STUDENTS' for update;
  if not found then raise exception 'Import not found.'; end if;
  if b.status <> 'PREVIEW' then raise exception 'This import has already been processed.'; end if;
  if p_mode not in ('CREATE', 'UPDATE') then raise exception 'Choose how to handle students that already exist.'; end if;

  for r in select value from jsonb_array_elements(b.rows) loop
    if coalesce(r ->> '_status', '') <> 'OK' then continue; end if;
    select id into sess from academic_sessions
     where (nullif(r ->> 'academic_session', '') is null and status = 'ACTIVE')
        or replace(label, '–', '-') = replace(r ->> 'academic_session', '–', '-')
     limit 1;
    if sess is null then raise exception 'Academic session % was not found.', r ->> 'academic_session'; end if;

    cls := (r ->> 'class_id')::smallint;
    secname := nullif(btrim(r ->> 'section'), '');
    strmname := nullif(btrim(r ->> 'stream'), '');
    sec := null; strm := null;
    if secname is not null then
      select id into sec from sections where name = secname;
      if sec is null then insert into sections (name) values (secname) returning id into sec; end if;
    end if;
    if strmname is not null then
      select id into strm from streams where lower(name) = lower(strmname);
      if strm is null then insert into streams (name) values (strmname) returning id into strm; end if;
    end if;
    if sec is null and strm is null then
      select id into sec from sections where name = 'A';
    end if;

    select id into cs from class_sections
     where session_id = sess and class_id = cls and section_id is not distinct from sec and stream_id is not distinct from strm;
    if cs is null then
      select classes.roman into roman from classes where id = cls;
      lbl := roman || coalesce(' ' || strmname, '') || coalesce('-' || secname, '');
      insert into class_sections (session_id, class_id, section_id, stream_id, label)
      values (sess, cls, sec, strm, lbl) returning id into cs;
      cs_created := cs_created + 1;
    end if;

    select id into sid from students where scholar_number = r ->> 'scholar_number';
    exists_student := sid is not null;
    if not exists_student then
      insert into students (scholar_number, student_code, admission_number, name, dob, gender, father_name, mother_name, mobile, address)
      values (r ->> 'scholar_number', nullif(r ->> 'student_code', ''), nullif(r ->> 'admission_number', ''), r ->> 'name',
              nullif(r ->> 'dob', '')::date, nullif(r ->> 'gender', ''), nullif(r ->> 'father_name', ''), nullif(r ->> 'mother_name', ''),
              nullif(r ->> 'mobile', ''), nullif(r ->> 'address', ''))
      returning id into sid;
      created := created + 1;
    elsif p_mode = 'UPDATE' then
      update students set
        name = coalesce(nullif(r ->> 'name', ''), name),
        dob = coalesce(nullif(r ->> 'dob', '')::date, dob),
        gender = coalesce(nullif(r ->> 'gender', ''), gender),
        father_name = coalesce(nullif(r ->> 'father_name', ''), father_name),
        mother_name = coalesce(nullif(r ->> 'mother_name', ''), mother_name),
        mobile = coalesce(nullif(r ->> 'mobile', ''), mobile),
        address = coalesce(nullif(r ->> 'address', ''), address),
        admission_number = coalesce(nullif(r ->> 'admission_number', ''), admission_number)
      where id = sid;
      updated := updated + 1;
    else
      skipped := skipped + 1; continue;
    end if;

    select id into en from student_class_enrollments where student_id = sid and session_id = sess;
    if en is null then
      insert into student_class_enrollments (student_id, session_id, class_section_id, roll_number)
      values (sid, sess, cs, nullif(r ->> 'roll_number', '')::int);
      enrolled := enrolled + 1;
    elsif p_mode = 'UPDATE' then
      update student_class_enrollments set class_section_id = cs,
             roll_number = coalesce(nullif(r ->> 'roll_number', '')::int, roll_number)
       where id = en;
    end if;
  end loop;

  update import_batches set status = 'COMMITTED', mode = p_mode,
         summary = summary || jsonb_build_object('result', jsonb_build_object(
           'created', created, 'updated', updated, 'skipped', skipped, 'enrolled', enrolled, 'class_sections_created', cs_created))
   where id = p_batch;
  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped, 'enrolled', enrolled, 'class_sections_created', cs_created);
end $$;

-- ---------- bulk import: teachers + assignments ----------
create function public.commit_import_teachers(p_batch uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b import_batches; r jsonb; sess uuid; cls smallint; sec uuid; strm uuid; cs uuid; csub uuid; tid uuid;
  secname text; strmname text; subj text; roman text; lbl text; had boolean;
  created int := 0; updated int := 0; assigned int := 0; unmatched int := 0;
begin
  if not app.is_admin() then raise exception 'Only administrators can import data.'; end if;
  select * into b from import_batches where id = p_batch and kind = 'TEACHERS' for update;
  if not found then raise exception 'Import not found.'; end if;
  if b.status <> 'PREVIEW' then raise exception 'This import has already been processed.'; end if;
  if p_mode not in ('CREATE', 'UPDATE') then raise exception 'Choose how to handle teachers that already exist.'; end if;

  for r in select value from jsonb_array_elements(b.rows) loop
    if coalesce(r ->> '_status', '') <> 'OK' then continue; end if;
    select id into tid from teachers where employee_id = r ->> 'employee_id';
    had := tid is not null;
    if not had then
      insert into teachers (employee_id, name, email, mobile, designation, department, status)
      values (r ->> 'employee_id', r ->> 'name', nullif(lower(r ->> 'email'), ''), nullif(r ->> 'mobile', ''),
              nullif(r ->> 'designation', ''), nullif(r ->> 'department', ''),
              case when upper(coalesce(r ->> 'status', '')) = 'INACTIVE' then 'INACTIVE' else 'ACTIVE' end::record_status)
      returning id into tid;
      created := created + 1;
    elsif p_mode = 'UPDATE' then
      update teachers set name = coalesce(nullif(r ->> 'name', ''), name),
             email = coalesce(nullif(lower(r ->> 'email'), ''), email),
             mobile = coalesce(nullif(r ->> 'mobile', ''), mobile),
             designation = coalesce(nullif(r ->> 'designation', ''), designation),
             department = coalesce(nullif(r ->> 'department', ''), department)
       where id = tid;
      updated := updated + 1;
    end if;
    update teachers t set profile_id = p.id from profiles p
     where t.id = tid and t.profile_id is null and t.email is not null and lower(p.email) = lower(t.email);

    if nullif(r ->> 'class_id', '') is not null then
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
      if cs is null then unmatched := unmatched + 1; continue; end if;
      subj := nullif(btrim(r ->> 'subject'), '');
      if subj is null then
        if not exists (select 1 from teacher_assignments where teacher_id = tid and class_section_id = cs and role = 'CLASS') then
          insert into teacher_assignments (session_id, teacher_id, class_section_id, role) values (sess, tid, cs, 'CLASS');
          assigned := assigned + 1;
        end if;
      else
        select c.id into csub from class_subjects c join subjects s on s.id = c.subject_id
         where c.session_id = sess and c.class_id = cls and c.status = 'ACTIVE'
           and (lower(s.name) = lower(subj) or lower(c.display_label) = lower(subj))
         order by c.display_order limit 1;
        if csub is null then unmatched := unmatched + 1; continue; end if;
        if not exists (select 1 from teacher_assignments where teacher_id = tid and class_section_id = cs and class_subject_id = csub and role = 'SUBJECT') then
          insert into teacher_assignments (session_id, teacher_id, class_section_id, class_subject_id, role) values (sess, tid, cs, csub, 'SUBJECT');
          assigned := assigned + 1;
        end if;
      end if;
    end if;
  end loop;

  update import_batches set status = 'COMMITTED', mode = p_mode,
         summary = summary || jsonb_build_object('result', jsonb_build_object(
           'created', created, 'updated', updated, 'assignments', assigned, 'unmatched', unmatched))
   where id = p_batch;
  return jsonb_build_object('created', created, 'updated', updated, 'assignments', assigned, 'unmatched', unmatched);
end $$;

-- ---------- new academic session (clone structure forward) ----------
create function public.create_session(p_label text, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = public as $$
declare prev uuid; new_id uuid;
begin
  if not app.is_admin() then raise exception 'Only administrators can create sessions.'; end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'Enter a session label.'; end if;
  if exists (select 1 from academic_sessions where replace(label, '–', '-') = replace(btrim(p_label), '–', '-')) then
    raise exception 'This academic session already exists.';
  end if;
  select id into prev from academic_sessions order by created_at desc limit 1;
  insert into academic_sessions (label, start_date, end_date, status)
  values (replace(btrim(p_label), '–', '-'), p_start, p_end, 'DRAFT') returning id into new_id;
  if prev is not null then
    insert into class_sections (session_id, class_id, section_id, stream_id, label)
    select new_id, class_id, section_id, stream_id, label from class_sections where session_id = prev and status = 'ACTIVE';
  end if;
  perform public.seed_session_defaults(new_id);
  if prev is not null then
    insert into teacher_assignments (session_id, teacher_id, class_section_id, class_subject_id, role)
    select new_id, a.teacher_id, ncs.id, ncsub.id, a.role
      from teacher_assignments a
      join class_sections ocs on ocs.id = a.class_section_id
      join class_sections ncs on ncs.session_id = new_id and ncs.class_id = ocs.class_id
           and ncs.section_id is not distinct from ocs.section_id and ncs.stream_id is not distinct from ocs.stream_id
      left join class_subjects ocsub on ocsub.id = a.class_subject_id
      left join class_subjects ncsub on ncsub.session_id = new_id and ncsub.class_id = ocsub.class_id
           and ncsub.subject_id = ocsub.subject_id and ncsub.stream_id is not distinct from ocsub.stream_id
     where a.session_id = prev and (a.role = 'CLASS' or ncsub.id is not null);
  end if;
  return new_id;
end $$;

create function public.activate_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only administrators can change the active session.'; end if;
  update academic_sessions set status = 'CLOSED' where status = 'ACTIVE' and id <> p_session;
  update academic_sessions set status = 'ACTIVE' where id = p_session;
  update school_settings set active_session_id = p_session;
end $$;

-- ---------- promotion (old enrollments are never changed) ----------
create function public.promote_students(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; ncs uuid; nen uuid; promoted int := 0; alumni int := 0; skipped int := 0; roman text; sec_name text;
begin
  if not app.is_admin() then raise exception 'Only administrators can promote students.'; end if;
  if p_from = p_to then raise exception 'Choose two different sessions.'; end if;
  for e in
    select en.id as en_id, en.student_id, en.roll_number, cs.class_id, cs.section_id, cs.stream_id
      from student_class_enrollments en join class_sections cs on cs.id = en.class_section_id
     where en.session_id = p_from and en.status = 'ACTIVE'
  loop
    if exists (select 1 from student_class_enrollments where student_id = e.student_id and session_id = p_to) then
      skipped := skipped + 1; continue;
    end if;
    if e.class_id >= 12 then
      update students set status = 'ALUMNI' where id = e.student_id; alumni := alumni + 1; continue;
    end if;
    select id into ncs from class_sections
     where session_id = p_to and class_id = e.class_id + 1
       and section_id is not distinct from e.section_id and stream_id is not distinct from e.stream_id;
    if ncs is null then
      select classes.roman into roman from classes where id = e.class_id + 1;
      select name into sec_name from sections where id = e.section_id;
      insert into class_sections (session_id, class_id, section_id, stream_id, label)
      values (p_to, e.class_id + 1, e.section_id, e.stream_id,
              roman || coalesce(' ' || (select name from streams where id = e.stream_id), '') || coalesce('-' || sec_name, ''))
      returning id into ncs;
    end if;
    insert into student_class_enrollments (student_id, session_id, class_section_id, roll_number)
    values (e.student_id, p_to, ncs,
            case when exists (select 1 from student_class_enrollments x where x.class_section_id = ncs and x.roll_number = e.roll_number and x.status = 'ACTIVE')
                 then null else e.roll_number end)
    returning id into nen;
    if e.class_id >= 11 then
      insert into student_subject_choices (enrollment_id, subject_group_id, class_subject_id)
      select nen, ch.subject_group_id, nc.id
        from student_subject_choices ch
        join class_subjects oc on oc.id = ch.class_subject_id
        join class_subjects nc on nc.session_id = p_to and nc.class_id = e.class_id + 1 and nc.subject_id = oc.subject_id
       where ch.enrollment_id = e.en_id
      on conflict do nothing;
    end if;
    promoted := promoted + 1;
  end loop;
  return jsonb_build_object('promoted', promoted, 'alumni', alumni, 'skipped', skipped);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.clone_examination(uuid, text, text, boolean), public.create_annual_examination(uuid, text, text, annual_method, jsonb),
  public.commit_import_students(uuid, text), public.commit_import_teachers(uuid, text), public.create_session(text, date, date),
  public.activate_session(uuid), public.promote_students(uuid, uuid) to authenticated;
