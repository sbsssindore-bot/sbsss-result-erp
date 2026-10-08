# SBSSS Result ERP — Production plan (Supabase + Next.js + Vercel)

Status: **Application built (Phases 4–14). Build, unit, database and PDF tests pass locally. Live deployment and live-Supabase testing still to do (Phase 15).**

## 1. What was inspected
| Item | Finding |
|---|---|
| `1st-12th_template_final.pdf` | Source of truth for six report-card structures (A–F). Seeded in `0003_seed.sql`. Typo "& &" fixed in template F heading. |
| Test prototype `school-result-erp-test.html` | Single file, browser-only. Reusable: report-card HTML/CSS, calculation rules (integer-cents arithmetic, lower-bound grades), validation messages, screen flow. **Not reusable as backend.** |
| Hard-coded data in prototype | 84 demo students, 3 demo teachers, plain demo passwords, demo marks. All removed in production; nothing is seeded except configuration. |
| Student / teacher Excel or CSV | **Not received yet.** Column names are not assumed. See §5. |

## 2. Architecture
```
Browser / PWA (Next.js App Router, React, TypeScript, Tailwind)
   │  Supabase Auth session (httpOnly cookies via @supabase/ssr)
Next.js on Vercel
   ├─ Server components / route handlers  → Supabase client with the USER's JWT (RLS applies)
   ├─ Server-only admin actions            → service-role key (never sent to browser)
   ├─ Calculation engine (TypeScript, pure, unit-tested)  + DB constraints/triggers as final gate
   └─ Report-card renderer (HTML templates → PDF via headless Chromium)
Supabase: PostgreSQL (RLS) · Auth · Storage (logo, generated PDFs, import files)
```
Key rule: normal reads/writes run **as the signed-in user**, so Postgres RLS is the real security boundary. The service-role key is used only in server code for imports, invitations and PDF jobs.

## 3. Database (see `supabase/migrations`)
- `0001_schema.sql` — tables, constraints, indexes, helper functions, triggers (server-side marks validation, workflow, audit).
- `0002_rls.sql` — Row Level Security: admin = all; teacher = own class-section + subject only; anon = nothing.
- `0003_seed.sql` — classes 1–12, sections A–E, streams, grade scale, result rules, templates A–F, session 2026-27 with Term I, subjects, co-scholastic areas, XI–XII slots and 30/70 vs 20/80 limits.

Relationships: `academic_sessions → class_sections (class + section and/or stream) → student_class_enrollments → students`;
`teachers → teacher_assignments → class_section + class_subject`;
`examinations → exam_components (per template) → marks (via mark_batches) → report_cards`.
Student master is stored once; enrollments are per session.

### Workflow enforced in the database
`DRAFT → SUBMITTED → VERIFIED → LOCKED`. Teachers can only DRAFT→SUBMITTED. Admin can verify, lock, and unlock/return **only with a reason**. Locked sheets reject every edit. Over-maximum, negative, non-applicable or wrong-class marks are rejected by trigger regardless of the client. Every change to marks, batches, enrollments, assignments, settings etc. is written to `audit_logs` with who / old / new / student / subject / component / exam.

## 4. Authentication and roles
- Supabase Auth (email + password, invite and reset by email). A trigger creates a `profiles` row (role TEACHER) for every new user and **links it to the imported teacher by e-mail**, so imported teachers get their assignments automatically after they sign up.
- The first Admin is promoted once with SQL (see README). Admin promotes others from the UI.
- No passwords in Excel. Teacher import creates the `teachers` row and assignments, then sends an invitation / reset link.
- Middleware protects routes; the UI hides menus, but RLS enforces access.

## 5. Bulk import strategy (students and teachers)
1. Admin uploads `.xlsx`/`.csv` → file parsed server-side (SheetJS) → rows stored as an `import_batches` PREVIEW.
2. **Column mapping:** headers are matched by name/aliases (e.g. "Scholar No", "Adm No"); anything unrecognised is shown for manual mapping. Nothing is assumed silently.
3. **Normalisation** (already in SQL and tested): `app.normalize_class` (I, 1, Class I, 1st, Grade 1, VI, 10th → 1–12), `app.normalize_section` ("Section A", "A Section" → A), `app.normalize_stream` (Sci → Science).
4. **Preview report:** total / valid / invalid rows, duplicates (scholar number, or name+DOB+father), unknown class/section, missing required fields, and every mapping the system applied. Errors list row, column, reason.
5. Admin chooses **Create / Update existing / Skip duplicates**, then **Confirm import**.
6. Commit runs as **one database transaction** (RPC function): create sections/class-sections on demand, upsert students, create enrollments. Any failure rolls everything back.
7. Dashboard counts by Session → Class → Section come from queries over `class_sections`/`enrollments`, so no manual segregation is needed.
8. Teachers: one row per assignment (employee, class, section, subject); multiple rows per teacher; subjects matched to `class_subjects`; unmatched subjects are reported, not guessed.
Templates (`students_import_template.xlsx`, `teachers_import_template.xlsx`) are generated with the columns listed in the brief and shipped in Phase 6.

## 6. Report-card template strategy
Templates A–F are rows in `report_card_templates` (layout flags: headings, legend position, subject-code column, summary label, co-scholastic on/off, slot rows). One renderer reads the layout plus a normalised result object — no six separate hard-coded pages. Exam display names come from `examinations.display_name` / `term_label`. Watermark, logo and signature labels come from `school_settings`. Snapshot of rendered data is stored in `report_cards.snapshot`.

## 7. Migration plan (prototype → production)
| Step | Action |
|---|---|
| 1 | Create Supabase project; run the three migrations (README). |
| 2 | Create first Admin user; promote with SQL. |
| 3 | Build Next.js app: auth, layout, PWA shell (Phase 4). |
| 4 | Port prototype screens to React/TS against Supabase (Phases 5–9). |
| 5 | Port calculation engine + report-card CSS from prototype (Phases 10–12). |
| 6 | Import real data after the preview/mapping is approved (Phases 6–7). |
| 7 | Deploy to Vercel; set env vars; test on phones (Phases 14–15). |

## 8. Phase status
| Phase | Scope | Status |
|---|---|---|
| 1 | Inspect project/files | ✅ (student/teacher files still needed) |
| 2 | Schema design | ✅ |
| 3 | Tables, RLS, seed | ✅ 62 automated checks pass |
| 4 | Auth + roles + app shell | ⏳ next |
| 5–8 | Masters, bulk import, class/section aggregation, teacher assignments | ⏳ |
| 9–10 | Examinations, marks, calculation engine | ⏳ |
| 11–12 | Template engine, PDF | ⏳ |
| 13–15 | Dashboard/search/audit UI, PWA, deploy | ⏳ |

Not claimed complete: acceptance criteria 4–30 are untested because the application layer does not exist yet.
