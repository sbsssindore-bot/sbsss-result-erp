# Deployment guide (GitHub → Vercel → Supabase)

Do these in order. Stop after each step and check it worked.

## Step 1 — Supabase: create the database tables
1. Open your Supabase project → left menu **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_schema.sql`, copy everything, paste, click **Run**. Wait for "Success".
3. Repeat for `0002_rls.sql`, `0003_seed.sql`, `0004_functions.sql`, then `0005_import_teachers_assignments.sql` (always in this order, one at a time). If you already ran 0001–0004 earlier, run only 0005.
4. Left menu **Table Editor**: you should see tables such as `students`, `class_sections`, `examinations`.

## Step 2 — Supabase: your administrator login
1. **Authentication → Users → Add user → Create new user.** Enter your email and a strong password. Tick **Auto Confirm User**.
2. **SQL Editor → New query**, paste (use your email) and **Run**:
   `update profiles set role = 'ADMIN' where email = 'your-email@example.com';`

## Step 3 — Supabase: copy three values (do not share the third)
**Project Settings → API**: copy **Project URL**, **anon public key**, and **service_role key** (secret, only for Vercel).

## Step 4 — Supabase: allowed website address (after Vercel gives you an address)
**Authentication → URL Configuration**: set **Site URL** to your Vercel address, and add `https://YOUR-ADDRESS.vercel.app/auth/callback` under **Redirect URLs**.

## Step 5 — GitHub
Upload this project to `sbsssindore-bot/sbsss-result-erp` (branch `main`). Do not upload `.env` files.

## Step 6 — Vercel
1. vercel.com → **Add New → Project** → import the GitHub repository. **Framework Preset must say Next.js.**
2. Before clicking Deploy open **Environment Variables** and add:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.
3. **Deploy.** Open the address, sign in with the administrator email and password.

## Step 7 — first use (in this order)
1. **Settings:** check school name, upload logo if different.
2. **Import Students:** download the sample CSV, put your data in the same columns, upload, match columns, preview, confirm.
3. **Import Teachers:** same steps (Teacher ID, Name, Mobile, Email, Designation, Login ID, Session, Status).
4. **Bulk Import Assignments:** one row per Teacher ID + Session + Class + Section + Subject. Class teachers: leave Subject empty and write `Class Teacher` in Role.
5. **Teachers → Send invites to all:** each teacher gets an email to set their own password. Afterwards they can sign in with their email **or** their Login ID / Teacher ID.
6. Marks entry → Review & Lock → Report Cards.

**Email limit:** Supabase's free built-in email service sends only a few emails per hour. For 50–100 teachers, set up your own mail sender first: Supabase → Authentication → **SMTP Settings** (any provider such as Gmail/Resend/Brevo). Otherwise send invites in small batches.

## Teacher self-activation (migration 0006)
Run `supabase/migrations/0006_teacher_activation.sql` once in the Supabase SQL Editor (after 0001–0005).
Teachers then open `<your-site>/teacher-activate`, enter Teacher ID + registered email, choose a password, and sign in with their Login ID.
