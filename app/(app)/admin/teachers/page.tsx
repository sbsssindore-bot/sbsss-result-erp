import Link from 'next/link';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import Flash from '@/components/Flash';
import { saveTeacher, toggleTeacher, inviteTeacher, resetTeacherPassword, inviteAllTeachers } from './actions';

export default async function Teachers({ searchParams }: { searchParams: { add?: string; edit?: string; msg?: string; err?: string } }) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const teachers = await fetchAll((a, b) => sb.from('teachers').select('*').order('name').range(a, b));
  const assigns = session ? await fetchAll((a, b) => sb.from('teacher_assignments').select('teacher_id').eq('session_id', session.id).range(a, b)) : [];
  const n = (id: string) => assigns.filter((a: any) => a.teacher_id === id).length;
  const editing = searchParams.edit ? teachers.find((t: any) => t.id === searchParams.edit) : null;
  const showForm = searchParams.add || editing;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="h2 !mb-0 flex-1">Teachers</h1>
        <Link className="btn" href="/admin/teachers?add=1">Add teacher</Link><Link className="btn btn-sec" href="/admin/import/teachers">Import Teachers</Link><Link className="btn btn-sec" href="/admin/assignments">Assign classes</Link><form action={inviteAllTeachers}><button className="btn btn-ghost">Send invites to all</button></form></div>
      <p className="muted mb-3 text-sm">Teachers activate their own account at <b>/teacher-activate</b> using their Teacher ID and registered email — no need to create logins by hand. Invites are optional.</p>
      <Flash msg={searchParams.msg} err={searchParams.err} />
      {showForm && (
        <form action={saveTeacher} className="card max-w-3xl"><h2 className="h3">{editing ? 'Edit teacher' : 'Add teacher'}</h2>
          <input type="hidden" name="id" value={editing?.id || ''} />
          <div className="grid gap-x-4 md:grid-cols-2">
            <label className="lbl">Employee ID *<input className="input" name="employee_id" defaultValue={editing?.employee_id} required /></label>
            <label className="lbl">Name *<input className="input" name="name" defaultValue={editing?.name} required /></label>
            <label className="lbl">Email (this is their login) *<input className="input" type="email" name="email" defaultValue={editing?.email || ''} required /></label>
            <label className="lbl">Mobile<input className="input" name="mobile" defaultValue={editing?.mobile || ''} /></label>
            <label className="lbl">Designation<input className="input" name="designation" defaultValue={editing?.designation || ''} /></label>
            <label className="lbl">Department<input className="input" name="department" defaultValue={editing?.department || ''} /></label>
            <label className="lbl">Login ID / username (optional)<input className="input" name="login_id" defaultValue={editing?.login_id || ''} placeholder="e.g. neha.verma" /></label></div>
          <div className="flex gap-2"><button className="btn">Save teacher</button><Link className="btn btn-ghost" href="/admin/teachers">Cancel</Link></div></form>)}
      <div className="tw"><table className="t"><thead><tr><th>Teacher ID</th><th>Name</th><th>Email</th><th>Login ID</th><th>Mobile</th><th>Account</th><th>Assignments</th><th>Status</th><th></th></tr></thead><tbody>
        {teachers.map((t: any) => (
          <tr key={t.id}><td>{t.employee_id}</td><td>{t.name}</td><td>{t.email}</td><td>{t.login_id}</td><td>{t.mobile}</td>
            <td>{t.profile_id ? <span className="chip chip-ok">Activated / Has login</span> : <span className="chip chip-warn">Not Activated</span>}</td><td>{n(t.id)}</td>
            <td>{t.status === 'ACTIVE' ? <span className="chip chip-ok">Active</span> : <span className="chip chip-bad">Inactive</span>}</td>
            <td className="flex flex-wrap gap-1"><Link className="btn btn-sm btn-ghost" href={`/admin/teachers?edit=${t.id}`}>Edit</Link><Link className="btn btn-sm btn-ghost" href={`/admin/assignments?teacher=${t.id}`}>Assign</Link>
              {!t.profile_id ? <form action={inviteTeacher}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm btn-sec">Send invite</button></form>
                : <form action={resetTeacherPassword}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm btn-ghost">Reset password</button></form>}
              <form action={toggleTeacher}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="to" value={t.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'} /><button className="btn btn-sm btn-ghost">{t.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></form></td></tr>))}
        {teachers.length === 0 && <tr><td colSpan={9} className="muted">No teachers yet. Add one or use Import Teachers.</td></tr>}
      </tbody></table></div>
    </>
  );
}
