'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const ALLOWED = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'];

export async function adminSetStatus(fd: FormData) {
  const { sb } = await requireAdmin();
  const id = String(fd.get('id') || ''), to = String(fd.get('to') || ''), reason = String(fd.get('reason') || '').trim();
  const back = String(fd.get('back') || '/admin/review');
  const safeBack = back.startsWith('/') ? back : '/admin/review';
  const sep = safeBack.includes('?') ? '&' : '?';
  if (!id || !ALLOWED.includes(to)) redirect(`${safeBack}${sep}err=${encodeURIComponent('Invalid request.')}`);
  if (to === 'DRAFT' && !reason) redirect(`${safeBack}${sep}err=${encodeURIComponent('A reason is required to unlock or return marks.')}`);
  const patch: any = { status: to };
  if (to === 'DRAFT') patch.unlock_reason = reason;
  const { error } = await sb.from('mark_batches').update(patch).eq('id', id);
  revalidatePath('/marks'); revalidatePath('/admin/review'); revalidatePath('/class-entry');
  redirect(`${safeBack}${sep}${error ? 'err=' + encodeURIComponent(friendlyError(error)) : 'msg=' + encodeURIComponent('Status updated.')}`);
}

export async function lockAllSubmitted(fd: FormData) {
  const { sb } = await requireAdmin();
  const exam = String(fd.get('exam') || '');
  const { error, count } = await sb.from('mark_batches').update({ status: 'LOCKED' }, { count: 'exact' }).eq('examination_id', exam).in('status', ['SUBMITTED', 'VERIFIED']);
  revalidatePath('/admin/review');
  redirect(`/admin/review?exam=${exam}&${error ? 'err=' + encodeURIComponent(friendlyError(error)) : 'msg=' + encodeURIComponent(`${count || 0} sheet(s) locked.`)}`);
}
