'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const back = (m: string, err = false): never => redirect(`/admin/sessions?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);
const refresh = () => ['/admin', '/admin/sessions', '/admin/students', '/admin/classes', '/admin/exams'].forEach((p) => revalidatePath(p));

export async function createSession(fd: FormData) {
  const { sb } = await requireAdmin();
  const { error } = await sb.rpc('create_session', { p_label: String(fd.get('label') || ''), p_start: String(fd.get('start') || '') || null, p_end: String(fd.get('end') || '') || null });
  refresh();
  return back(error ? friendlyError(error) : 'Session created with the previous structure, subjects, Term I and teacher assignments. Previous session data is unchanged.', !!error);
}
export async function activateSession(fd: FormData) {
  const { sb } = await requireAdmin();
  const { error } = await sb.rpc('activate_session', { p_session: String(fd.get('id')) });
  refresh();
  return back(error ? friendlyError(error) : 'Active session changed.', !!error);
}
export async function promote(fd: FormData) {
  const { sb } = await requireAdmin();
  const { data, error } = await sb.rpc('promote_students', { p_from: String(fd.get('from')), p_to: String(fd.get('to')) });
  refresh();
  if (error) return back(friendlyError(error), true);
  const r = data as any;
  return back(`${r.promoted} promoted, ${r.alumni} moved to alumni${r.skipped ? `, ${r.skipped} already enrolled` : ''}. Old session records are untouched. Check Class XI students for stream and subject choices.`);
}
