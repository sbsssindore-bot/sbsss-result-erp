import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';

export async function getCtx() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  let teacher: any = null;
  if (profile) teacher = (await sb.from('teachers').select('*').eq('profile_id', user.id).maybeSingle()).data;
  const active = profile?.status === 'ACTIVE';
  return { sb, user, profile, teacher, isAdmin: active && profile?.role === 'ADMIN' };
}
export async function requireCtx() {
  const c = await getCtx();
  if (!c) redirect('/login');
  if (!c.profile || c.profile.status !== 'ACTIVE') redirect('/login?error=inactive');
  return c;
}
export async function requireAdmin() {
  const c = await requireCtx();
  if (!c.isAdmin) redirect('/teacher');
  return c;
}

/** Active (or requested) session, its examinations and the chosen examination. */
export async function sessionAndExams(sb: any, p: { session?: string; exam?: string } = {}) {
  const { data: settings } = await sb.from('school_settings').select('*').maybeSingle();
  let session: any = null;
  if (p.session) session = (await sb.from('academic_sessions').select('*').eq('id', p.session).maybeSingle()).data;
  if (!session && settings?.active_session_id) session = (await sb.from('academic_sessions').select('*').eq('id', settings.active_session_id).maybeSingle()).data;
  if (!session) session = (await sb.from('academic_sessions').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  const exams: any[] = session ? ((await sb.from('examinations').select('*').eq('session_id', session.id).order('sequence')).data || []) : [];
  const exam = exams.find((e) => e.id === p.exam) || [...exams].reverse().find((e) => e.status === 'OPEN') || exams[0] || null;
  return { settings, session, exams, exam };
}
