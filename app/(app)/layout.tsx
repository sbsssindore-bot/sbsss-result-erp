import Shell from '@/components/Shell';
import { requireCtx } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const ADMIN = [
  ['/admin', 'Dashboard'], ['/admin/students', 'Students'], ['/admin/import/students', '↳ Import Students'], ['/admin/teachers', 'Teachers'], ['/admin/import/teachers', '↳ Import Teachers'],
  ['/admin/classes', 'Classes & Sections'], ['/admin/assignments', 'Teacher Assignments'], ['/admin/import/assignments', '↳ Bulk Import Assignments'],
  ['/admin/exams', 'Examinations'], ['/marks', 'Marks Entry'], ['/class-entry', 'Attendance & Grades'],
  ['/admin/review', 'Review & Lock'], ['/admin/reports', 'Report Cards'], ['/admin/sessions', 'Academic Sessions'],
  ['/admin/settings', 'Settings'], ['/admin/audit', 'Audit Log'],
].map(([href, label]) => ({ href, label }));
const TEACHER = [['/teacher', 'Dashboard'], ['/marks', 'Marks Entry'], ['/class-entry', 'Attendance & Grades']].map(([href, label]) => ({ href, label }));

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx();
  const name = c.teacher?.name || c.profile.full_name || c.user.email || 'User';
  return <Shell nav={c.isAdmin ? ADMIN : TEACHER} name={name} role={c.isAdmin ? 'Admin' : 'Teacher'}>{children}</Shell>;
}
