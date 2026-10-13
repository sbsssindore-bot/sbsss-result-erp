-- Assign co-scholastic/activity grades to specific teachers per class.
create table if not exists public.teacher_grade_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  area_id uuid not null references public.co_scholastic_areas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, teacher_id, class_id, area_id)
);
create index if not exists teacher_grade_assignments_teacher_session_idx
  on public.teacher_grade_assignments (teacher_id, session_id);
create index if not exists teacher_grade_assignments_class_area_idx
  on public.teacher_grade_assignments (class_id, area_id);
