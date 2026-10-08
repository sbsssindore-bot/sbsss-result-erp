'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { fetchAll, friendlyError } from '@/lib/db';
import { FIELDS, type Kind } from '@/lib/importFields';
import { autoMap, extractAssignments, extractStudents, extractTeachers, missingRequired, parseSheet, type Item } from '@/lib/importParse';
import { toStoredRows, validateAssignments, validateStudents, validateTeachers, type Report } from '@/lib/importValidate';

const isKind = (k: string): k is Kind => ['STUDENTS', 'TEACHERS', 'ASSIGNMENTS'].includes(k);
const MAX_BYTES = 4 * 1024 * 1024, MAX_ROWS = 5000;

/* ---------- step 1: read the file and propose a column mapping ---------- */
export type ReadResult = {
  ok: boolean; error?: string; headers: string[]; rowCount: number; sample: string[][];
  fields: { key: string; label: string; required: boolean; hint?: string }[]; mapping: Record<string, string>;
};
const emptyRead = (error: string): ReadResult => ({ ok: false, error, headers: [], rowCount: 0, sample: [], fields: [], mapping: {} });

export async function readImportFile(fd: FormData): Promise<ReadResult> {
  await requireAdmin();
  const kind = String(fd.get('kind'));
  if (!isKind(kind)) return emptyRead('Unknown import type.');
  const file = fd.get('file') as File | null;
  if (!file || !file.size) return emptyRead('Choose an Excel (.xlsx) or CSV file.');
  if (file.size > MAX_BYTES) return emptyRead('The file is larger than 4 MB. Split it into smaller files.');
  try {
    const { headers, rows } = parseSheet(await file.arrayBuffer(), file.name);
    if (!headers.length || !rows.length) return emptyRead('The file has no data rows. The first row must contain the column headings.');
    if (rows.length > MAX_ROWS) return emptyRead(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    return {
      ok: true, headers, rowCount: rows.length, mapping: autoMap(kind, headers),
      sample: rows.slice(0, 4).map((r) => headers.map((h) => String(r[h] instanceof Date ? r[h].toISOString().slice(0, 10) : r[h] ?? ''))),
      fields: FIELDS[kind].map(({ key, label, required, hint }) => ({ key, label, required, hint })),
    };
  } catch (e: any) { return emptyRead(`Could not read this file. Save it as .xlsx or UTF-8 .csv and try again. (${e?.message || 'unknown error'})`); }
}

/* ---------- step 2: validate with the chosen mapping and store a PREVIEW batch ---------- */
export type Preview = {
  ok: boolean; error?: string; batchId?: string; kind?: Kind; fileName?: string;
  total: number; valid: number; invalid: number; existing: number; conflicts: number; warnings: number;
  errors: { row: number; message: string }[]; warningList: { row: number; message: string }[];
  normalized: { column: string; from: string; to: string }[]; newSections: string[]; sample: Record<string, any>[];
};
const emptyPreview = (error: string): Preview => ({ ok: false, error, total: 0, valid: 0, invalid: 0, existing: 0, conflicts: 0, warnings: 0, errors: [], warningList: [], normalized: [], newSections: [], sample: [] });

export async function previewImport(fd: FormData): Promise<Preview> {
  const { sb, user } = await requireAdmin();
  const kind = String(fd.get('kind'));
  if (!isKind(kind)) return emptyPreview('Unknown import type.');
  const file = fd.get('file') as File | null;
  if (!file || !file.size) return emptyPreview('Choose a file first.');
  let mapping: Record<string, string> = {};
  try { mapping = JSON.parse(String(fd.get('mapping') || '{}')); } catch { return emptyPreview('The column mapping is not valid.'); }
  try {
    const { headers, rows } = parseSheet(await file.arrayBuffer(), file.name);
    for (const [f, h] of Object.entries(mapping)) if (!h || !headers.includes(h)) delete mapping[f];
    const missing = missingRequired(kind, mapping);
    if (missing.length) return emptyPreview(`Please map these required columns: ${missing.join(', ')}.`);
    if (rows.length > MAX_ROWS) return emptyPreview(`More than ${MAX_ROWS.toLocaleString()} rows. Split the file.`);

    const { data: settings } = await sb.from('school_settings').select('active_session_id').maybeSingle();
    const sessions = await fetchAll((a, b) => sb.from('academic_sessions').select('id,label').range(a, b));
    const activeId = settings?.active_session_id as string | undefined;
    let items: Item[]; let report: Report;

    if (kind === 'STUDENTS') {
      items = extractStudents(rows, mapping);
      const dbStudents = await fetchAll((a, b) => sb.from('students').select('id,scholar_number,name,dob,father_name').range(a, b));
      const dbEnr = await fetchAll((a, b) => sb.from('student_class_enrollments').select('student_id,roll_number,session_id,class_sections(class_id,sections(name),streams(name))').eq('status', 'ACTIVE').range(a, b));
      const dbRolls = new Map<string, string>();
      dbEnr.forEach((e: any) => { const c = e.class_sections; if (c && e.roll_number != null) dbRolls.set(`${e.session_id}|${c.class_id}|${c.sections?.name || ''}|${c.streams?.name || ''}|${e.roll_number}`, e.student_id); });
      const secs = await fetchAll((a, b) => sb.from('class_sections').select('session_id,class_id,sections(name),streams(name)').range(a, b));
      report = validateStudents(items, { sessions, activeId, dbStudents, dbRolls, sectionKeys: new Set(secs.map((c: any) => `${c.session_id}|${c.class_id}|${c.sections?.name || ''}|${c.streams?.name || ''}`)) });
    } else if (kind === 'TEACHERS') {
      items = extractTeachers(rows, mapping);
      const dbTeachers = await fetchAll((a, b) => sb.from('teachers').select('employee_id,email,login_id').range(a, b));
      report = validateTeachers(items, { sessions, dbTeachers });
    } else {
      items = extractAssignments(rows, mapping);
      const [teachers, css, subs, asg] = await Promise.all([
        fetchAll((a, b) => sb.from('teachers').select('id,employee_id,name,status').range(a, b)),
        fetchAll((a, b) => sb.from('class_sections').select('id,session_id,class_id,sections(name),streams(name)').range(a, b)),
        fetchAll((a, b) => sb.from('class_subjects').select('id,session_id,class_id,display_label,streams(name),subjects(name)').eq('status', 'ACTIVE').range(a, b)),
        fetchAll((a, b) => sb.from('teacher_assignments').select('teacher_id,class_section_id,class_subject_id,role,teachers(name)').range(a, b)),
      ]);
      report = validateAssignments(items, {
        sessions, activeId, teachers,
        classSections: css.map((c: any) => ({ id: c.id, session_id: c.session_id, class_id: c.class_id, section: c.sections?.name || null, stream: c.streams?.name || null })),
        classSubjects: subs.map((c: any) => ({ id: c.id, session_id: c.session_id, class_id: c.class_id, name: c.subjects?.name || '', label: c.display_label, stream: c.streams?.name || null })),
        assignments: asg.map((a: any) => ({ teacher_id: a.teacher_id, class_section_id: a.class_section_id, class_subject_id: a.class_subject_id, role: a.role, teacher_name: a.teachers?.name || '' })),
      });
    }

    const stored = toStoredRows(items);
    const bad = items.filter((i) => i.errors.length), warn = items.filter((i) => i.warnings.length && !i.errors.length);
    const errorsOut = bad.flatMap((i) => i.errors.map((m) => ({ row: i.row, message: m })));
    const warnOut = warn.flatMap((i) => i.warnings.map((m) => ({ row: i.row, message: m })));
    const { data: batch, error } = await sb.from('import_batches').insert({
      kind, file_name: file.name, status: 'PREVIEW', created_by: user.id, rows: stored,
      summary: { total: items.length, valid: items.length - bad.length, invalid: bad.length, existing: report.existing, conflicts: report.conflicts, mapping }, errors: errorsOut.slice(0, 500),
    }).select('id').single();
    if (error) return emptyPreview(friendlyError(error));
    return {
      ok: true, batchId: batch.id, kind, fileName: file.name, total: items.length, valid: items.length - bad.length, invalid: bad.length,
      existing: report.existing, conflicts: report.conflicts, warnings: warnOut.length, errors: errorsOut.slice(0, 200), warningList: warnOut.slice(0, 100),
      normalized: report.normalized, newSections: report.newSections, sample: stored.slice(0, 8),
    };
  } catch (e: any) { return emptyPreview(friendlyError(e)); }
}

/* ---------- step 3: confirm → one database transaction ---------- */
export async function commitImport(batchId: string, kind: Kind, mode: string): Promise<{ ok: boolean; error?: string; result?: Record<string, number> }> {
  const { sb } = await requireAdmin();
  const fn = kind === 'STUDENTS' ? 'commit_import_students' : kind === 'TEACHERS' ? 'commit_import_teachers' : 'commit_import_assignments';
  const { data, error } = await sb.rpc(fn, { p_batch: batchId, p_mode: mode });
  if (error) return { ok: false, error: friendlyError(error) + ' Nothing was imported.' };
  ['/admin', '/admin/students', '/admin/teachers', '/admin/classes', '/admin/assignments', '/teacher', '/marks'].forEach((p) => revalidatePath(p));
  return { ok: true, result: data as Record<string, number> };
}
