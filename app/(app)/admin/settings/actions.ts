'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase/admin';

const back = (m: string, err = false): never => redirect(`/admin/settings?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}`);
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function saveSettings(fd: FormData) {
  const { sb } = await requireAdmin();
  const op = Math.min(30, Math.max(2, Number(fd.get('wm_opacity')) || 6)) / 100;
  const patch: any = {
    school_name: s(fd, 'school_name') || 'SHRI BHARTIYA SANSKRITI SHIKSHA SANSTHAN', address: s(fd, 'address') || null, phone: s(fd, 'phone') || null, email: s(fd, 'email') || null,
    principal_name: s(fd, 'principal_name') || null, issue_date: s(fd, 'issue_date') || null,
    signature_labels: { class_teacher: s(fd, 'sig_ct') || 'Class Teacher Signature', parent: s(fd, 'sig_pa') || 'Parent / Guardian Signature', principal: s(fd, 'sig_pr') || 'Principal Signature' },
    watermark: { enabled: fd.get('wm_on') === 'on', opacity: op },
  };
  try {
    const file = fd.get('logo') as File | null;
    if (file && file.size) {
      if (file.size > 1024 * 1024) return back('The logo must be smaller than 1 MB.', true);
      if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) return back('Use a PNG, JPG, WebP or SVG image.', true);
      const admin = supabaseAdmin();
      await admin.storage.createBucket('branding', { public: true }).catch(() => {});
      const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : file.type.includes('svg') ? 'svg' : 'jpg';
      const path = `logo-${Date.now()}.${ext}`;
      const up = await admin.storage.from('branding').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
      if (up.error) return back(`Logo upload failed: ${up.error.message}`, true);
      patch.logo_path = path;
    } else if (fd.get('logo_remove') === 'on') patch.logo_path = null;
    const { error } = await sb.from('school_settings').update(patch).eq('id', true);
    if (error) return back(friendlyError(error), true);
    revalidatePath('/', 'layout');
    return back('Settings saved.');
  } catch (e: any) { if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return back(friendlyError(e), true); }
}

export async function saveGradeScale(fd: FormData) {
  const { sb } = await requireAdmin();
  try {
    const rows: { id: string; grade: string; min: number; del: boolean }[] = [];
    for (const [k, v] of fd.entries()) { const m = k.match(/^g_([0-9a-f-]{36})$/); if (m) rows.push({ id: m[1], grade: String(v).trim(), min: Number(fd.get(`m_${m[1]}`)), del: fd.get(`d_${m[1]}`) === 'on' }); }
    const ng = s(fd, 'new_grade'), nm = s(fd, 'new_min');
    const keep = rows.filter((r) => !r.del);
    if (keep.some((r) => !r.grade || !(r.min >= 0 && r.min <= 100))) return back('Each grade needs a name and a minimum between 0 and 100.', true);
    const mins = keep.map((r) => r.min).concat(ng && nm !== '' ? [Number(nm)] : []);
    if (new Set(mins).size !== mins.length) return back('Two grades cannot have the same minimum percentage.', true);
    if (!mins.includes(0)) return back('The lowest grade must start at 0%.', true);
    const { data: scale } = await sb.from('grade_scales').select('id').eq('is_default', true).single();
    for (const r of rows.filter((x) => x.del)) { const e = await sb.from('grade_scale_bands').delete().eq('id', r.id); if (e.error) return back(friendlyError(e.error), true); }
    for (const r of keep) { const e = await sb.from('grade_scale_bands').update({ grade: r.grade, min_percentage: r.min }).eq('id', r.id); if (e.error) return back(friendlyError(e.error), true); }
    if (ng && nm !== '') { const e = await sb.from('grade_scale_bands').insert({ scale_id: scale!.id, grade: ng, min_percentage: Number(nm), sort_order: 99 }); if (e.error) return back(friendlyError(e.error), true); }
    revalidatePath('/admin/settings');
    return back('Grade scale saved.');
  } catch (e: any) { if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return back(friendlyError(e), true); }
}
