import { requireAdmin } from '@/lib/auth';
import Flash from '@/components/Flash';
import { logoUrl } from '@/lib/logo';
import { saveSettings, saveGradeScale } from './actions';

export default async function Settings({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { data: s } = await sb.from('school_settings').select('*').single();
  const { data: scale } = await sb.from('grade_scales').select('id').eq('is_default', true).single();
  const { data: bands } = await sb.from('grade_scale_bands').select('*').eq('scale_id', scale!.id).order('min_percentage', { ascending: false });
  const sig = s.signature_labels || {}, wm = s.watermark || { enabled: true, opacity: 0.06 };
  return (
    <>
      <h1 className="h2">Settings</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <form action={saveSettings} encType="multipart/form-data" className="card max-w-3xl"><h2 className="h3">School information (appears on every report card)</h2>
        <div className="grid gap-x-4 md:grid-cols-2">
          <label className="lbl md:col-span-2">School name<input className="input" name="school_name" defaultValue={s.school_name} required /></label>
          <label className="lbl">Principal name<input className="input" name="principal_name" defaultValue={s.principal_name || ''} /></label>
          <label className="lbl">Report-card issue date<input className="input" type="date" name="issue_date" defaultValue={s.issue_date || ''} /></label>
          <label className="lbl">Address<input className="input" name="address" defaultValue={s.address || ''} /></label>
          <label className="lbl">Phone<input className="input" name="phone" defaultValue={s.phone || ''} /></label>
          <label className="lbl">Email<input className="input" name="email" defaultValue={s.email || ''} /></label></div>
        <h3 className="h3 mt-2">Signature labels</h3>
        <div className="grid gap-x-4 md:grid-cols-3"><label className="lbl">Class teacher<input className="input" name="sig_ct" defaultValue={sig.class_teacher} /></label><label className="lbl">Parent / guardian<input className="input" name="sig_pa" defaultValue={sig.parent} /></label><label className="lbl">Principal<input className="input" name="sig_pr" defaultValue={sig.principal} /></label></div>
        <h3 className="h3 mt-2">Logo and watermark</h3>
        <div className="mb-3 flex flex-wrap items-center gap-4"><img src={logoUrl(s)} alt="Current logo" className="h-20 w-20 rounded border border-line object-contain" />
          <div><label className="lbl !mb-1">Upload a new logo (PNG/JPG, under 1 MB)<input className="input" type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></label>
            {s.logo_path && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="logo_remove" className="h-5 w-5" /> Remove custom logo (use the built-in SBSSS logo)</label>}</div></div>
        <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wm_on" defaultChecked={wm.enabled} className="h-5 w-5" /> Show logo as watermark on report cards</label>
          <label className="lbl !mb-0">Watermark strength (2–30 %)<input className="input !w-28" type="number" min={2} max={30} name="wm_opacity" defaultValue={Math.round((wm.opacity ?? 0.06) * 100)} /></label></div>
        <div className="mt-4"><button className="btn">Save settings</button></div></form>
      <form action={saveGradeScale} className="card max-w-xl"><h2 className="h3">Grade scale</h2>
        <p className="muted mb-2">A student gets the highest grade whose minimum is at or below the exact percentage.</p>
        <div className="tw"><table className="t"><thead><tr><th>Grade</th><th>Minimum %</th><th>Remove</th></tr></thead><tbody>
          {(bands || []).map((b: any) => <tr key={b.id}><td><input className="input !min-h-[36px] !w-24" name={`g_${b.id}`} defaultValue={b.grade} /></td><td><input className="input !min-h-[36px] !w-28" type="number" step="0.01" name={`m_${b.id}`} defaultValue={Number(b.min_percentage)} /></td><td><input type="checkbox" name={`d_${b.id}`} className="h-5 w-5" /></td></tr>)}
          <tr><td><input className="input !min-h-[36px] !w-24" name="new_grade" placeholder="New" /></td><td><input className="input !min-h-[36px] !w-28" type="number" step="0.01" name="new_min" placeholder="Min %" /></td><td></td></tr></tbody></table></div>
        <div className="mt-3"><button className="btn">Save grade scale</button></div></form>
    </>
  );
}
