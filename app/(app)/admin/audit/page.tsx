import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';

const TABLES = ['', 'marks', 'mark_batches', 'attendance', 'co_scholastic_marks', 'report_remarks', 'students', 'student_class_enrollments', 'teacher_assignments', 'teachers', 'profiles', 'examinations', 'grade_scale_bands', 'school_settings'];
const show = (r: any) => {
  const o = r.old_value || {}, n = r.new_value || {};
  if (r.table_name === 'marks') return `${o.value ?? '—'}${o.is_absent ? ' (AB)' : ''} → ${n.value ?? '—'}${n.is_absent ? ' (AB)' : ''}`;
  if (r.table_name === 'mark_batches') return `${o.status ?? '—'} → ${n.status ?? '—'}`;
  const keys = Object.keys(n).filter((k) => JSON.stringify(n[k]) !== JSON.stringify(o[k]) && !['updated_at', 'created_at', 'id'].includes(k)).slice(0, 4);
  return keys.map((k) => `${k}: ${o[k] ?? '—'} → ${n[k] ?? '—'}`).join('; ') || (r.action === 'INSERT' ? 'created' : r.action === 'DELETE' ? 'deleted' : '');
};
export default async function Audit({ searchParams }: { searchParams: { table?: string } }) {
  const { sb } = await requireAdmin();
  let q = sb.from('audit_logs').select('*').order('id', { ascending: false }).limit(200);
  if (searchParams.table) q = q.eq('table_name', searchParams.table);
  const { data } = await q;
  return (
    <>
      <h1 className="h2">Audit log</h1>
      <div className="mb-3 flex flex-wrap gap-2">{TABLES.map((t) => <Link key={t} href={t ? `/admin/audit?table=${t}` : '/admin/audit'} className={`rounded-md border px-3 py-1.5 text-sm ${(searchParams.table || '') === t ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{t || 'All'}</Link>)}</div>
      <div className="tw"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Change</th><th>Reason</th></tr></thead><tbody>
        {(data || []).map((r: any) => { const c = r.context || {}; return (
          <tr key={r.id}><td>{new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td><td>{r.actor_email || 'system'}</td><td>{r.action}</td>
            <td className="wrap">{r.table_name}{c.student ? ` · ${c.student}` : ''}{c.subject ? ` · ${c.subject}` : ''}{c.component ? ` · ${c.component}` : ''}{c.class ? ` · ${c.class}` : ''}{c.exam ? ` · ${c.exam}` : ''}</td><td className="wrap">{show(r)}</td><td>{r.reason || ''}</td></tr>); })}
        {(data || []).length === 0 && <tr><td colSpan={6} className="muted">No entries yet.</td></tr>}
      </tbody></table></div>
    </>
  );
}
