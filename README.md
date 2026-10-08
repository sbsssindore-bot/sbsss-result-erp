# SBSSS Result ERP

Shri Bhartiya Sanskriti Shiksha Sansthan, Indore — school result management.
**Stack:** Next.js 14 (App Router) · React · TypeScript · Tailwind · Supabase (PostgreSQL, Auth, RLS) · Vercel.

## What is in this repository
| Path | Purpose |
|---|---|
| `app/` | Pages and server actions (login, admin, teacher, marks, reports, import, API routes) |
| `components/` | UI components (shell, marks grid, import client, …) |
| `lib/` | Calculation engine, report-card template, data loader, import parser, Supabase clients |
| `public/` | Logo, PWA icons, service worker, offline page |
| `supabase/migrations/` | Database: tables, RLS security, seed data, admin functions (run in order 0001 → 0004) |
| `tests/` | Calculation, report-card and database tests |
| `docs/` | Plan and deployment guide |

## Commands
```
npm install
npm run build        # production build
npm test             # calculation + report-card tests
npm run test:db      # runs the SQL migrations on a real PostgreSQL and checks RLS, imports, promotion
npx tsx scripts/pdf-smoke.ts   # makes sample report-card PDFs in ./out
```

## Environment variables
See `.env.example`. **Never commit real keys.** The service-role key is server-only.

## Deploying
Follow `docs/DEPLOY.md` (Supabase → GitHub → Vercel, one step at a time).

## Imports (Admin)
Students, Teachers and Teacher Assignments each have: Upload → read CSV/Excel → column mapping → preview and validation → duplicate/error report → confirm → one database transaction. Sample CSV/Excel templates are on each import page.
