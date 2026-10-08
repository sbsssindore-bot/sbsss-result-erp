'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCtx } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

const Input = z.object({
  examId: z.string().uuid(), csId: z.string().uuid(), submit: z.boolean(),
  rows: z.array(z.object({
    e: z.string().uuid(), working: z.number().min(0).max(366).nullable(), present: z.number().min(0).max(366).nullable(),
    co: z.record(z.string().uuid(), z.string().max(3)), remarks: z.string().max(500), status: z.string().max(40).nullable(),
  })).max(500),
});

export async function saveClassEntry(raw: unknown): Promise<{ ok: boolean; error?: string; message?: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Some values are not valid. Check attendance (0–366) and remarks length.' };
  const i = parsed.data;
  const { sb, isAdmin } = await requireCtx();
  try {
    let { data: batch } = await sb.from('mark_batches').select('*').eq('examination_id', i.examId).eq('class_section_id', i.csId).is('class_subject_id', null).maybeSingle();
    if (!batch) {
      const ins = await sb.from('mark_batches').insert({ examination_id: i.examId, class_section_id: i.csId }).select().single();
      if (ins.error) return { ok: false, error: friendlyError(ins.error) };
      batch = ins.data;
    }
    if (batch.status === 'LOCKED') return { ok: false, error: 'Exam is locked.' };
    const base = { batch_id: batch.id, examination_id: i.examId };

    const att = i.rows.filter((r) => r.working != null || r.present != null).map((r) => ({ ...base, enrollment_id: r.e, working_days: r.working, present_days: r.present }));
    if (att.length) { const { error } = await sb.from('attendance').upsert(att, { onConflict: 'enrollment_id,examination_id' }); if (error) return { ok: false, error: friendlyError(error) }; }

    const co: any[] = [], coDel: { e: string; a: string }[] = [];
    for (const r of i.rows) for (const [area, g] of Object.entries(r.co)) { if (g) co.push({ ...base, enrollment_id: r.e, area_id: area, grade: g }); else coDel.push({ e: r.e, a: area }); }
    if (co.length) { const { error } = await sb.from('co_scholastic_marks').upsert(co, { onConflict: 'enrollment_id,examination_id,area_id' }); if (error) return { ok: false, error: friendlyError(error) }; }
    for (const d of coDel) await sb.from('co_scholastic_marks').delete().eq('enrollment_id', d.e).eq('examination_id', i.examId).eq('area_id', d.a);

    const rem = i.rows.map((r) => ({ ...base, enrollment_id: r.e, remarks: r.remarks || null, ...(isAdmin ? { result_status: r.status || null } : {}) }));
    if (rem.length) { const { error } = await sb.from('report_remarks').upsert(rem, { onConflict: 'enrollment_id,examination_id' }); if (error) return { ok: false, error: friendlyError(error) }; }

    if (i.submit && batch.status === 'DRAFT') {
      const { error } = await sb.from('mark_batches').update({ status: 'SUBMITTED' }).eq('id', batch.id);
      if (error) return { ok: false, error: friendlyError(error) };
    }
    revalidatePath('/class-entry');
    return { ok: true, message: i.submit ? 'Submitted.' : 'Saved.' };
  } catch (e) { return { ok: false, error: friendlyError(e) }; }
}
