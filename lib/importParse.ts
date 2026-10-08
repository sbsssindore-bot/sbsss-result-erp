import * as XLSX from 'xlsx';
import { FIELDS, type Kind } from './importFields';
import { normalizeClass, normalizeSection, normalizeStream, normalizeSessionLabel, normalizeGender, normalizeDate } from './normalize';

export type { Kind };
export type Raw = Record<string, any>;
const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Reads .xlsx/.xls/.csv. CSV is decoded as UTF-8 (so Hindi names survive) and values are kept as text. */
export function parseSheet(buf: ArrayBuffer, fileName = ''): { headers: string[]; rows: Raw[] } {
  const isCsv = /\.(csv|txt)$/i.test(fileName);
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: !isCsv ? true : true });
  const headers = ((grid[0] as any[]) || []).map((h) => String(h ?? '').trim());
  const rows: Raw[] = [];
  for (const line of grid.slice(1)) {
    if (!line || line.every((c) => String(c ?? '').trim() === '')) continue;
    const o: Raw = {};
    headers.forEach((h, i) => { if (h !== '') o[h] = line[i] ?? ''; });
    rows.push(o);
  }
  return { headers: headers.filter((h) => h !== ''), rows };
}

/** Automatic column guess; the admin can change it on the mapping screen. */
export function autoMap(kind: Kind, headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}; const used = new Set<string>();
  for (const f of FIELDS[kind]) {
    const h = headers.find((x) => !used.has(x) && (f.aliases.includes(key(x)) || key(x) === key(f.key) || key(x) === key(f.label)));
    if (h) { mapping[f.key] = h; used.add(h); }
  }
  return mapping;
}
export function missingRequired(kind: Kind, mapping: Record<string, string>) {
  return FIELDS[kind].filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
const intOrNull = (v: unknown) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const INACTIVE = new Set(['inactive', 'in active', 'no', 'n', '0', 'false', 'left', 'resigned', 'inactiv']);
export const parseActive = (v: unknown): 'ACTIVE' | 'INACTIVE' => (INACTIVE.has(str(v).toLowerCase()) ? 'INACTIVE' : 'ACTIVE');
export const parseRole = (v: unknown): 'SUBJECT' | 'CLASS' | 'UNKNOWN' => {
  const s = key(v);
  if (!s || ['subject', 'subjectteacher', 'st'].includes(s)) return 'SUBJECT';
  if (['class', 'classteacher', 'ct', 'classincharge', 'incharge'].includes(s)) return 'CLASS';
  return 'UNKNOWN';
};

export type Item = { row: number; data: Raw; errors: string[]; warnings: string[]; raw: Raw };
type G = (r: Raw, f: string) => any;
const getter = (mapping: Record<string, string>): G => (r, f) => (mapping[f] ? r[mapping[f]] : '');

export function extractStudents(rows: Raw[], mapping: Record<string, string>): Item[] {
  const g = getter(mapping);
  return rows.map((r, i) => {
    const errors: string[] = [], warnings: string[] = [];
    const rawClass = str(g(r, 'class')), rawSec = str(g(r, 'section')), rawStream = str(g(r, 'stream'));
    const cls = normalizeClass(rawClass), sec = normalizeSection(rawSec), stream = normalizeStream(rawStream);
    const scholar = str(g(r, 'scholar_number')), name = str(g(r, 'name'));
    if (!scholar) errors.push('scholar number: missing');
    if (!name) errors.push('student name: missing');
    if (!rawClass) errors.push('class: missing'); else if (cls == null) errors.push(`class: unknown value “${rawClass}”`);
    if (cls != null && !sec && !stream) errors.push('section (or stream): missing');
    const roll = intOrNull(g(r, 'roll_number'));
    if (roll != null && (Number.isNaN(roll) || roll < 1 || !Number.isInteger(roll))) errors.push('roll number: must be a whole number from 1');
    if (roll == null) warnings.push('roll number missing');
    const dobRaw = g(r, 'dob'); const dob = normalizeDate(dobRaw);
    if (str(dobRaw) && !dob) errors.push(`date of birth: invalid “${str(dobRaw)}” (use DD-MM-YYYY or YYYY-MM-DD)`);
    return {
      row: i + 2, raw: { class: rawClass, section: rawSec, stream: rawStream }, errors, warnings,
      data: { scholar_number: scholar, student_code: str(g(r, 'student_code')) || null, name, father_name: str(g(r, 'father_name')) || null, mother_name: str(g(r, 'mother_name')) || null,
        dob, gender: normalizeGender(g(r, 'gender')), class_id: cls, section: sec, stream, roll_number: roll == null || Number.isNaN(roll) ? null : roll,
        admission_number: str(g(r, 'admission_number')) || null, mobile: str(g(r, 'mobile')) || null, address: str(g(r, 'address')) || null,
        academic_session: normalizeSessionLabel(str(g(r, 'academic_session'))) },
    };
  });
}

export function extractTeachers(rows: Raw[], mapping: Record<string, string>): Item[] {
  const g = getter(mapping);
  return rows.map((r, i) => {
    const errors: string[] = [], warnings: string[] = [];
    const emp = str(g(r, 'employee_id')), name = str(g(r, 'name')), email = str(g(r, 'email')).toLowerCase(), login = str(g(r, 'login_id'));
    if (!emp) errors.push('Teacher ID: missing');
    if (!name) errors.push('Teacher name: missing');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`email: invalid “${email}”`);
    if (login && !/^[A-Za-z0-9._-]{3,40}$/.test(login)) errors.push(`login ID: use 3–40 letters, digits, dot, dash or underscore (no spaces) — “${login}”`);
    if (!email) warnings.push('no email: this teacher cannot receive a login invitation');
    return { row: i + 2, raw: {}, errors, warnings,
      data: { employee_id: emp, name, email: email || null, mobile: str(g(r, 'mobile')) || null, designation: str(g(r, 'designation')) || null, department: str(g(r, 'department')) || null,
        login_id: login || null, academic_session: normalizeSessionLabel(str(g(r, 'academic_session'))), status: parseActive(g(r, 'status')) } };
  });
}

export function extractAssignments(rows: Raw[], mapping: Record<string, string>): Item[] {
  const g = getter(mapping);
  return rows.map((r, i) => {
    const errors: string[] = [], warnings: string[] = [];
    const emp = str(g(r, 'employee_id')), rawClass = str(g(r, 'class')), rawSec = str(g(r, 'section')), rawStream = str(g(r, 'stream')), subject = str(g(r, 'subject'));
    const cls = normalizeClass(rawClass), sec = normalizeSection(rawSec), stream = normalizeStream(rawStream), role = parseRole(g(r, 'role'));
    if (!emp) errors.push('Teacher ID: missing');
    if (!rawClass) errors.push('class: missing'); else if (cls == null) errors.push(`class: unknown value “${rawClass}”`);
    if (cls != null && !sec && !stream) errors.push('section (or stream): missing');
    if (role === 'UNKNOWN') errors.push(`role: “${str(g(r, 'role'))}” is not understood (use Subject Teacher or Class Teacher)`);
    if (role === 'SUBJECT' && !subject) errors.push('subject: missing (leave it empty only for a Class Teacher row)');
    if (role === 'CLASS' && subject) warnings.push('subject ignored for a Class Teacher row');
    return { row: i + 2, raw: { class: rawClass, section: rawSec, stream: rawStream }, errors, warnings,
      data: { employee_id: emp, academic_session: normalizeSessionLabel(str(g(r, 'academic_session'))), class_id: cls, section: sec, stream,
        subject: role === 'SUBJECT' ? subject : null, role: role === 'CLASS' ? 'CLASS' : 'SUBJECT' } };
  });
}
