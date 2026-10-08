import { requireAdmin } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { createSession, activateSession, promote } from './actions';

export default async function Sessions({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const sessions = await fetchAll((a, b) => sb.from('academic_sessions').select('*').order('created_at').range(a, b));
  const enr = await fetchAll((a, b) => sb.from('student_class_enrollments').select('session_id').range(a, b));
  const n = (id: string) => enr.filter((e: any) => e.session_id === id).length;
  return (
    <>
      <h1 className="h2">Academic sessions</h1>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      <div className="card"><div className="tw"><table className="t"><thead><tr><th>Session</th><th>Status</th><th>Enrolled</th><th></th></tr></thead><tbody>
        {sessions.map((s: any) => <tr key={s.id}><td>{s.label}</td><td><span className={`chip ${s.status === 'ACTIVE' ? 'chip-ok' : ''}`}>{s.status}</span></td><td>{n(s.id)}</td>
          <td>{s.status !== 'ACTIVE' && <form action={activateSession}><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm btn-sec">Make active</button></form>}</td></tr>)}</tbody></table></div></div>
      <form action={createSession} className="card"><h2 className="h3">Create a new session</h2>
        <p className="muted mb-3">Copies class sections, subjects, co-scholastic areas, Term I structure and teacher assignments forward. Nothing in earlier sessions changes.</p>
        <div className="grid gap-x-4 md:grid-cols-3"><label className="lbl">Label *<input className="input" name="label" placeholder="2027-28" required /></label><label className="lbl">Start date<input className="input" type="date" name="start" /></label><label className="lbl">End date<input className="input" type="date" name="end" /></label></div>
        <button className="btn">Create session</button></form>
      {sessions.length > 1 && <form action={promote} className="card"><h2 className="h3">Promote students</h2>
        <p className="muted mb-3">Creates new enrollments in the target session (Class XII students become alumni). Old enrollments and marks are never changed.</p>
        <div className="flex flex-wrap items-end gap-3"><label className="lbl !mb-0">From<select className="input" name="from" defaultValue={sessions[sessions.length - 2].id}>{sessions.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="lbl !mb-0">To<select className="input" name="to" defaultValue={sessions[sessions.length - 1].id}>{sessions.map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><button className="btn btn-sec">Promote</button></div></form>}
    </>
  );
}
