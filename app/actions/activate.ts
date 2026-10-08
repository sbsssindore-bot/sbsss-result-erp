'use server';
import { headers } from 'next/headers';
import { activateTeacher, supabaseStore, type ActivationResult } from '@/lib/teacherActivation';

/** Public server action. Uses the service-role key on the server only; nothing secret reaches the browser. */
export async function activateTeacherAccount(employeeId: string, email: string, password: string): Promise<ActivationResult> {
  const h = headers();
  const ip = (h.get('x-forwarded-for') || h.get('x-real-ip') || 'unknown').split(',')[0].trim();
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    return await activateTeacher(supabaseStore(supabaseAdmin()), { employeeId, email, password, ip });
  } catch {
    return { ok: false, code: 'ERROR', message: 'Activation is not available right now. Please contact the administrator.' };
  }
}
