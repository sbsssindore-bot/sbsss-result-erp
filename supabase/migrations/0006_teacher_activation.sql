-- =====================================================================
-- 0006 — Teacher self-service activation
-- Only adds a small throttling log. No existing table/policy is changed.
-- RLS is ON with NO policies: only the server (service role) can read/write it.
-- Safe to re-run.
-- =====================================================================
create table if not exists teacher_activation_attempts (
  id bigint generated always as identity primary key,
  employee_id text,
  ip text,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists taa_ip_idx on teacher_activation_attempts (ip, created_at desc);
create index if not exists taa_emp_idx on teacher_activation_attempts (lower(employee_id), created_at desc);
alter table teacher_activation_attempts enable row level security;
revoke all on teacher_activation_attempts from anon, authenticated;
