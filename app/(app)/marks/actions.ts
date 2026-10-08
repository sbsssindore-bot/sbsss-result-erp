'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCtx } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const Input = z.object({
  examId: z.string().uuid(), csId: z.string().uuid(), subId: z.string().uuid(), submit: z.boolean(),
  rows: z.array(z.object({ e: z.string().uuid(), c: z.string().uuid(), v: z.number().min(0).max(1000).nullable(), ab: z.boolean() })).max(3000),
});

export async function saveMarks(raw: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Some values are not valid. Check the highlighted cells.' };
  const i = parsed.data;
  const { sb, isAdmin } = await requireCtx();
  try {
    let { data: batch } = await sb.from('mark_batches').select('*').eq('examination_id', i.examId).eq('class_section_id', i.csId).eq('class_subject_id', i.subId).maybeSingle();
    if (!batch) {
      const ins = await sb.from('mark_batches').insert({ examination_id: i.examId, class_section_id: i.csId, class_subject_id: i.subId }).select().single();
      if (ins.error) return { ok: false, error: friendlyError(ins.error) };
      batch = ins.data;
    }
    if (batch.status === 'LOCKED') return { ok: false, error: 'Exam is locked.' };
    const rows = i.rows.map((r) => ({
      batch_id: batch.id, enrollment_id: r.e, examination_id: i.examId, class_subject_id: i.subId,
      component_id: r.c, value: r.ab ? null : r.v, is_absent: r.ab,
    }));
    if (rows.length) {
      const { error } = await sb.from('marks').upsert(rows, { onConflict: 'enrollment_id,examination_id,class_subject_id,component_id' });
      if (error) return { ok: false, error: friendlyError(error) };
    }
    if (i.submit && batch.status === 'DRAFT') {
      const { error } = await sb.from('mark_batches').update({ status: 'SUBMITTED' }).eq('id', batch.id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    revalidatePath('/marks');
    return { ok: true, message: i.submit ? (isAdmin ? 'Saved and marked as submitted.' : 'Marks submitted.') : 'Draft saved.' };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}
