import { ROMAN } from './format';
import type { Item } from './importParse';

/** Pure validation against data the server has already fetched, so it can be unit-tested. */
export type Session = { id: string; label: string };
const sessionFor = (sessions: Session[], activeId: string | undefined, label: string | null) => (label ? sessions.find((s) => s.label === label) : sessions.find((s) => s.id === activeId));
const csLabel = (c: number, stream: string | null, sec: string | null) => `${ROMAN[c]}${stream ? ' ' + stream : ''}${sec ? '-' + sec : ''}`;
export type Normalized = { column: string; from: string; to: string };
export type Report = { existing: number; conflicts: number; newSections: string[]; normalized: Normalized[] };

function noteNormalized(items: Item[], withClass = true): Normalized[] {
  const m = new Map<string, Normalized>();
  const note = (column: string, from: string, to: string) => { if (from && from !== to) m.set(`${column}|${from}`, { column, from, to }); };
  for (const it of items) {
    if (!withClass) continue;
    note('class', it.raw.class, it.data.class_id != null ? ROMAN[it.data.class_id] : '');
    note('section', it.raw.section, it.data.section || ''); note('stream', it.raw.stream, it.data.stream || '');
  }
  return [...m.values()].slice(0, 60);
}

export function validateStudents(items: Item[], ctx: {
  sessions: Session[]; activeId?: string; dbStudents: { id: string; scholar_number: string; name: string; dob: string | null; father_name: string | null }[];
  dbRolls: Map<string, string>; sectionKeys: Set<string>;
}): Report {
  const bySch = new Map(ctx.dbStudents.map((s) => [s.scholar_number, s]));
  const seen = new Map<string, number>(), rollSeen = new Map<string, number>();
  let existing = 0; const newSections = new Set<string>();
  const rk = (sid: string, c: number, sec: string | null, st: string | null, roll: number) => `${sid}|${c}|${sec || ''}|${st || ''}|${roll}`;
  for (const it of items) {
    const d = it.data;
    const s = sessionFor(ctx.sessions, ctx.activeId, d.academic_session);
    if (!s) it.errors.push(`academic session “${d.academic_session || ''}” not found`); else d._sid = s.id;
    if (!d.scholar_number) continue;
    if (seen.has(d.scholar_number)) it.errors.push(`duplicate scholar number in this file (also row ${seen.get(d.scholar_number)})`); else seen.set(d.scholar_number, it.row);
    const ex = bySch.get(d.scholar_number);
    if (ex) { existing++; it.warnings.push('already exists in the database'); }
    else {
      const dup = ctx.dbStudents.find((x) => x.name?.toLowerCase() === d.name.toLowerCase() && d.dob && x.dob === d.dob && (x.father_name || '').toLowerCase() === (d.father_name || '').toLowerCase());
      if (dup) it.warnings.push(`possible duplicate of scholar no. ${dup.scholar_number} (same name, date of birth and father)`);
    }
    if (d.roll_number != null && d._sid && d.class_id != null) {
      const key = rk(d._sid, d.class_id, d.section, d.stream, d.roll_number);
      if (rollSeen.has(key)) it.errors.push(`roll number ${d.roll_number} is repeated in this file (row ${rollSeen.get(key)})`); else rollSeen.set(key, it.row);
      const holder = ctx.dbRolls.get(key); if (holder && holder !== ex?.id) it.errors.push(`roll number ${d.roll_number} is already used in that class section`);
    }
    if (d._sid && d.class_id != null && !it.errors.length && !ctx.sectionKeys.has(`${d._sid}|${d.class_id}|${d.section || ''}|${d.stream || ''}`)) newSections.add(csLabel(d.class_id, d.stream, d.section));
  }
  return { existing, conflicts: 0, newSections: [...newSections].slice(0, 60), normalized: noteNormalized(items) };
}

export function validateTeachers(items: Item[], ctx: { sessions: Session[]; dbTeachers: { employee_id: string; email: string | null; login_id: string | null }[] }): Report {
  const seen = new Map<string, number>(); let existing = 0;
  const email = new Map<string, string>(), login = new Map<string, string>();
  ctx.dbTeachers.forEach((t) => { if (t.email) email.set(t.email.toLowerCase(), t.employee_id); if (t.login_id) login.set(t.login_id.toLowerCase(), t.employee_id); });
  const dbIds = new Set(ctx.dbTeachers.map((t) => t.employee_id));
  for (const it of items) {
    const d = it.data;
    if (d.academic_session && !ctx.sessions.some((s) => s.label === d.academic_session)) it.errors.push(`academic session “${d.academic_session}” not found`);
    if (!d.employee_id) continue;
    if (seen.has(d.employee_id)) it.errors.push(`duplicate Teacher ID in this file (also row ${seen.get(d.employee_id)})`); else { seen.set(d.employee_id, it.row); if (dbIds.has(d.employee_id)) { existing++; it.warnings.push('already exists in the database'); } }
    if (d.email) { const o = email.get(d.email); if (o && o !== d.employee_id) it.errors.push(`email already belongs to Teacher ID ${o}`); else email.set(d.email, d.employee_id); }
    if (d.login_id) { const o = login.get(d.login_id.toLowerCase()); if (o && o !== d.employee_id) it.errors.push(`login ID already used by Teacher ID ${o}`); else login.set(d.login_id.toLowerCase(), d.employee_id); }
  }
  return { existing, conflicts: 0, newSections: [], normalized: [] };
}

export type AssignCtx = {
  sessions: Session[]; activeId?: string;
  teachers: { id: string; employee_id: string; name: string; status: string }[];
  classSections: { id: string; session_id: string; class_id: number; section: string | null; stream: string | null }[];
  classSubjects: { id: string; session_id: string; class_id: number; name: string; label: string; stream: string | null }[];
  assignments: { teacher_id: string; class_section_id: string; class_subject_id: string | null; role: string; teacher_name: string }[];
};
export function validateAssignments(items: Item[], ctx: AssignCtx): Report {
  const byEmp = new Map(ctx.teachers.map((t) => [t.employee_id.toLowerCase(), t]));
  const seen = new Map<string, number>(); let existing = 0, conflicts = 0;
  for (const it of items) {
    const d = it.data;
    const s = sessionFor(ctx.sessions, ctx.activeId, d.academic_session);
    if (!s) it.errors.push(`academic session “${d.academic_session || ''}” not found`);
    const t = d.employee_id ? byEmp.get(String(d.employee_id).toLowerCase()) : null;
    if (d.employee_id && !t) it.errors.push(`Teacher ID “${d.employee_id}” not found (import teachers first)`);
    if (t && t.status !== 'ACTIVE') it.warnings.push(`teacher ${t.name} is inactive`);
    if (!s || d.class_id == null) continue;
    d._sid = s.id;
    const cs = ctx.classSections.find((c) => c.session_id === s.id && c.class_id === d.class_id && (c.section || '') === (d.section || '') && (c.stream || '') === (d.stream || ''));
    if (!cs) { it.errors.push(`class section ${csLabel(d.class_id, d.stream, d.section)} does not exist in ${s.label} (import students or add it under Classes & Sections)`); continue; }
    let csub: AssignCtx['classSubjects'][number] | undefined;
    if (d.role === 'SUBJECT' && d.subject) {
      const want = String(d.subject).toLowerCase();
      const m = ctx.classSubjects.filter((c) => c.session_id === s.id && c.class_id === d.class_id && (c.name.toLowerCase() === want || c.label.toLowerCase() === want));
      if (!m.length) { it.errors.push(`subject “${d.subject}” is not offered in class ${ROMAN[d.class_id]}`); continue; }
      csub = [...m].sort((a, b) => Number((b.stream || '') === (d.stream || '')) - Number((a.stream || '') === (d.stream || '')) || Number(!a.stream) - Number(!b.stream))[0];
    }
    if (!t) continue;
    const k = `${t.id}|${cs.id}|${csub?.id || ''}|${d.role}`;
    if (seen.has(k)) { it.errors.push(`duplicate of row ${seen.get(k)} in this file`); continue; } seen.set(k, it.row);
    const same = ctx.assignments.filter((a) => a.class_section_id === cs.id && a.role === d.role && (a.class_subject_id || null) === (csub?.id || null));
    if (same.some((a) => a.teacher_id === t.id)) { existing++; it.warnings.push('already assigned (will be skipped)'); }
    else if (same.length) { conflicts++; it.warnings.push(`${d.role === 'CLASS' ? 'class teacher' : 'subject'} already assigned to ${same.map((a) => a.teacher_name).join(', ')}`); }
  }
  return { existing, conflicts, newSections: [], normalized: noteNormalized(items) };
}

/** The exact shape saved in import_batches.rows and read by the commit_* database functions. */
export function toStoredRows(items: Item[]) {
  return items.map((it) => { const { _sid, ...data } = it.data; return { ...data, _row: it.row, _status: it.errors.length ? 'ERROR' : 'OK' }; });
}
