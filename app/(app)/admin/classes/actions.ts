'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { ROMAN } from '@/lib/format';
import { normalizeSection, normalizeStream } from '@/lib/normalize';

const back = (m: string, err = false): never => redirect(`/admin/classes?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);

export async function createClassSection(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const cls = Number(fd.get('class_id'));
  const secName = normalizeSection(fd.get('section')), strName = normalizeStream(fd.get('stream'));
  if (!session || !(cls >= 1 && cls <= 12)) return back('Choose a class.', true);
  if (!secName && !strName) return back('Enter a section (for example A) or choose a stream.', true);
  try {
    let secId: string | null = null, strId: string | null = null;
    if (secName) {
      const f = await sb.from('sections').select('id').eq('name', secName).maybeSingle();
      secId = f.data?.id || (await sb.from('sections').insert({ name: secName }).select('id').single()).data?.id || null;
    }
    if (strName) {
      const f = await sb.from('streams').select('id').ilike('name', strName).maybeSingle();
      strId = f.data?.id || (await sb.from('streams').insert({ name: strName }).select('id').single()).data?.id || null;
    }
    const label = `${ROMAN[cls]}${strName ? ' ' + strName : ''}${secName ? '-' + secName : ''}`;
    const { error } = await sb.from('class_sections').insert({ session_id: session.id, class_id: cls, section_id: secId, stream_id: strId, label });
    if (error) return back(/duplicate/i.test(error.message) ? `${label} already exists.` : friendlyError(error), true);
    revalidatePath('/admin/classes');
    return back(`${label} created.`);
  } catch (e: any) { if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return back(friendlyError(e), true); }
}

export async function setClassSectionStatus(fd: FormData) {
  const { sb } = await requireAdmin();
  const to = String(fd.get('to')) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const { error } = await sb.from('class_sections').update({ status: to }).eq('id', String(fd.get('id')));
  revalidatePath('/admin/classes');
  return back(error ? friendlyError(error) : to === 'ACTIVE' ? 'Class section activated.' : 'Class section deactivated. Its history is kept.', !!error);
}
