-- =====================================================================
-- SBSSS Result ERP — 0002 Row Level Security
-- Admin: everything.  Teacher: only own assignments (class-section + subject).
-- anon: nothing.  The service-role key (server only) bypasses RLS.
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant usage on schema public, app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$ declare t text; begin
  foreach t in array array['roles','profiles','academic_sessions','school_settings','classes','sections','streams',
    'class_sections','students','student_class_enrollments','teachers','subjects','subject_groups','class_subjects',
    'student_subject_choices','teacher_assignments','grade_scales','grade_scale_bands','result_statuses','result_rules',
    'co_grade_values','report_card_templates','examinations','exam_components','exam_component_limits','annual_rules',
    'annual_rule_sources','mark_batches','marks','co_scholastic_areas','co_scholastic_marks','attendance',
    'report_remarks','report_card_configurations','report_cards','import_batches','audit_logs']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- ---------- reference / configuration: readable by any active user, writable by admin ----------
do $$ declare t text; begin
  foreach t in array array['roles','academic_sessions','school_settings','classes','sections','streams','subjects',
    'subject_groups','class_subjects','grade_scales','grade_scale_bands','result_statuses','result_rules','co_grade_values',
    'report_card_templates','examinations','exam_components','exam_component_limits','annual_rules','annual_rule_sources',
    'co_scholastic_areas','report_card_configurations']
  loop
    execute format('create policy %I on %I for select to authenticated using (app.is_active_user())', t || '_read', t);
    execute format('create policy %I on %I for all to authenticated using (app.is_admin()) with check (app.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- ---------- admin-only ----------
do $$ declare t text; begin
  foreach t in array array['report_cards','import_batches']
  loop
    execute format('create policy %I on %I for all to authenticated using (app.is_admin()) with check (app.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- ---------- audit log: admins read; nobody writes directly (triggers are security definer) ----------
create policy audit_read on audit_logs for select to authenticated using (app.is_admin());

-- ---------- profiles ----------
create policy profiles_self  on profiles for select to authenticated using (id = auth.uid() or app.is_admin());
create policy profiles_admin on profiles for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy profiles_admin_ins on profiles for insert to authenticated with check (app.is_admin());
create policy profiles_admin_del on profiles for delete to authenticated using (app.is_admin());

-- ---------- teachers / assignments ----------
create policy teachers_self  on teachers for select to authenticated using (app.is_admin() or profile_id = auth.uid());
create policy teachers_admin on teachers for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy ta_self  on teacher_assignments for select to authenticated using (app.is_admin() or teacher_id = app.my_teacher_id());
create policy ta_admin on teacher_assignments for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ---------- class sections / students / enrollments: teachers see only their own classes ----------
create policy cs_teacher  on class_sections for select to authenticated using (app.is_admin() or id in (select app.my_class_sections()));
create policy cs_admin    on class_sections for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy enr_teacher on student_class_enrollments for select to authenticated
  using (app.is_admin() or class_section_id in (select app.my_class_sections()));
create policy enr_admin   on student_class_enrollments for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy stu_teacher on students for select to authenticated using (
  app.is_admin() or exists (select 1 from student_class_enrollments e
                            where e.student_id = students.id and e.class_section_id in (select app.my_class_sections())));
create policy stu_admin   on students for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy choice_teacher on student_subject_choices for select to authenticated using (
  app.is_admin() or exists (select 1 from student_class_enrollments e
                            where e.id = enrollment_id and e.class_section_id in (select app.my_class_sections())));
create policy choice_admin on student_subject_choices for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ---------- marks sheets ----------
-- NOTE: these policies use the row's own columns (not a lookup by id) so that
-- INSERT ... RETURNING works: a function cannot see the row being inserted.
create policy batch_read on mark_batches for select to authenticated
  using (app.is_admin() or app.can_open_batch(examination_id, class_section_id, class_subject_id));
create policy batch_ins  on mark_batches for insert to authenticated
  with check (app.is_admin() or (status = 'DRAFT' and app.can_open_batch(examination_id, class_section_id, class_subject_id)));
create policy batch_upd  on mark_batches for update to authenticated
  using (app.is_admin() or app.can_open_batch(examination_id, class_section_id, class_subject_id))
  with check (app.is_admin() or app.can_open_batch(examination_id, class_section_id, class_subject_id));
create policy batch_del  on mark_batches for delete to authenticated using (app.is_admin());

do $$ declare t text; begin
  foreach t in array array['marks','co_scholastic_marks','attendance','report_remarks']
  loop
    execute format('create policy %I on %I for select to authenticated using (app.is_admin() or app.teaches_batch(batch_id))', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (app.is_admin() or (app.teaches_batch(batch_id) and app.batch_status(batch_id) = ''DRAFT''))', t || '_ins', t);
    -- USING only checks ownership so the BEFORE trigger can raise a readable "already submitted" error;
    -- WITH CHECK is the hard gate (teachers can only write while the sheet is DRAFT).
    execute format('create policy %I on %I for update to authenticated using (app.is_admin() or app.teaches_batch(batch_id)) with check (app.is_admin() or (app.teaches_batch(batch_id) and app.batch_status(batch_id) = ''DRAFT''))', t || '_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (app.is_admin() or (app.teaches_batch(batch_id) and app.batch_status(batch_id) = ''DRAFT''))', t || '_del', t);
  end loop;
end $$;
