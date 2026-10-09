/**
 * Simplified teacher-assignment view of class sections — pure functions (no database access).
 *
 * Internally every marks sheet, enrolment and teacher_assignments row still points to a REAL class_section
 * (for XI–XII that is one row per stream, e.g. "XI PCB-A"). This module only groups those rows for the admin screen:
 *   - Classes I–X (no stream)  → one option per class_section, exactly as before ("IX-A").
 *   - Classes XI–XII (streams) → one option per class + section ("XI-A") that stands for all its stream sections.
 * Choosing "XI-A" expands to the stream sections underneath it, and a subject is attached to each stream section
 * where that subject is actually offered (class_subjects.stream_id is that stream, or null = common to all streams).
 */
export type Sec = { id: string; class_id: number; label: string; section_id?: string | null; stream_id?: string | null; sections?: { name?: string } | null; streams?: { name?: string } | null; classes?: { roman?: string } | null };
export type Group = { key: string; label: string; class_id: number; ids: string[]; streams: string[] };
export type Sub = { id: string; class_id: number; stream_id?: string | null; display_label?: string; subjects?: { name?: string } | null };

export function groupLabel(s: Sec): string {
  if (!s.stream_id) return s.label;
  const roman = s.classes?.roman || String(s.label).split(/[\s-]/)[0];
  const sec = s.sections?.name;
  return sec ? `${roman}-${sec}` : roman;
}
export const groupKey = (s: Sec) => (s.stream_id ? `${s.class_id}|${s.section_id || ''}` : s.id);

export function groupSections(secs: Sec[]): Group[] {
  const m = new Map<string, Group>();
  for (const s of secs) {
    const k = groupKey(s);
    const g = m.get(k) || { key: k, label: groupLabel(s), class_id: s.class_id, ids: [], streams: [] };
    g.ids.push(s.id);
    if (s.stream_id && s.streams?.name) g.streams.push(s.streams.name);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.class_id - b.class_id || a.label.localeCompare(b.label));
}

/** Accepts checkbox values that are a single id or a comma-separated list of ids. Only UUID-shaped ids are kept. */
export function parseIds(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) for (const p of String(v).split(',')) { const t = p.trim(); if (/^[0-9a-f-]{36}$/i.test(t)) out.add(t); }
  return [...out];
}

/**
 * The class_subject that applies to this class section:
 *  1. one defined for the same stream, else
 *  2. a common one (no stream), else
 *  3. LEGACY CASE – the section's stream has no subjects of its own at all (e.g. a stream created by an import such as "PCB"
 *     while the subject list was only set up for "Science"): keep the previous behaviour and use the same-named subject of the class.
 * If the stream has its own subject list and the subject is not in it, the subject is NOT offered there (undefined).
 */
export function pickSubject(subs: Sub[], cs: Sec, nameLower: string): Sub | undefined {
  const named = subs.filter((s) => s.class_id === cs.class_id && (String(s.subjects?.name).toLowerCase() === nameLower || String(s.display_label).toLowerCase() === nameLower));
  const sameStream = cs.stream_id ? named.find((s) => s.stream_id === cs.stream_id) : undefined;
  if (sameStream) return sameStream;
  const common = named.find((s) => !s.stream_id);
  if (common) return common;
  if (!cs.stream_id) return named[0];
  const streamHasOwnList = subs.some((s) => s.class_id === cs.class_id && s.stream_id === cs.stream_id);
  return streamHasOwnList ? undefined : named[0];
}

export type Existing = { id: string; teacher_id: string; class_section_id: string; class_subject_id: string };
export function planSubjectAssignments(p: { sections: Sec[]; subs: Sub[]; existing: Existing[]; names: string[]; teacher: string; mode: string; session: string }) {
  const add: any[] = []; const removeIds: string[] = []; let skippedMissing = 0, dup = 0, conflicts = 0;
  for (const cs of p.sections) for (const n of p.names) {
    const sub = pickSubject(p.subs, cs, n);
    if (!sub) { skippedMissing++; continue; }
    const same = p.existing.filter((e) => e.class_section_id === cs.id && e.class_subject_id === sub.id);
    if (same.some((e) => e.teacher_id === p.teacher)) { dup++; continue; }
    if (same.length) { conflicts++; if (p.mode === 'skip') continue; if (p.mode === 'replace') same.forEach((e) => removeIds.push(e.id)); }
    add.push({ session_id: p.session, teacher_id: p.teacher, class_section_id: cs.id, class_subject_id: sub.id, role: 'SUBJECT' });
  }
  return { add, removeIds, skippedMissing, dup, conflicts };
}
