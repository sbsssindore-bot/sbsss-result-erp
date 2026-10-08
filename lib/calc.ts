/**
 * Central calculation engine. Pure functions, integer "cents" arithmetic so decimals like 9.5 never drift.
 * Grade = highest band whose minimum is <= the EXACT percentage (lower-bound logic, no gaps).
 */
export type Band = { grade: string; min: number };
export type Comp = { code: string; label: string; max: number };
export type MarkVal = number | 'AB' | null | undefined;
export type Cell = { code: string; max: number; v: MarkVal };
export type SubjectResult = {
  totalC: number; maxC: number; total: number; max: number; pct: number;
  grade: string; complete: boolean; missing: number; cells: Cell[];
};
export type OverallResult = {
  totalC: number; maxC: number; total: number; max: number; pct: number; grade: string; complete: boolean;
};

export const C = (v: number) => Math.round(v * 100);

export function gradeOf(totalC: number, maxC: number, bands: Band[]): string {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (totalC * 100 >= b.min * maxC - 1e-7) return b.grade;
  return sorted.length ? sorted[sorted.length - 1].grade : '—';
}

function finish(totalC: number, maxC: number, missing: number, cells: Cell[], bands: Band[]): SubjectResult {
  const complete = missing === 0 && maxC > 0;
  return {
    totalC, maxC, total: totalC / 100, max: maxC / 100,
    pct: maxC ? (totalC * 100) / maxC : 0,
    grade: complete ? gradeOf(totalC, maxC, bands) : '—', complete, missing, cells,
  };
}

export function subjectResult(comps: Comp[], vals: Record<string, MarkVal>, bands: Band[]): SubjectResult {
  let t = 0, m = 0, missing = 0;
  const cells: Cell[] = [];
  for (const c of comps) {
    const v = vals[c.code];
    m += C(c.max);
    if (v == null) missing++;
    else if (v !== 'AB') t += C(v);
    cells.push({ code: c.code, max: c.max, v: v ?? null });
  }
  return finish(t, m, missing, cells, bands);
}

export function overallResult(
  items: { inOverall: boolean; r: SubjectResult }[], bands: Band[], extraIncomplete = false,
): OverallResult {
  let t = 0, m = 0, complete = !extraIncomplete;
  for (const it of items) {
    if (!it.inOverall) continue;
    t += it.r.totalC; m += it.r.maxC;
    if (!it.r.complete) complete = false;
  }
  if (!m) complete = false;
  return { totalC: t, maxC: m, total: t / 100, max: m / 100, pct: m ? (t * 100) / m : 0, grade: complete ? gradeOf(t, m, bands) : '—', complete };
}

/** Automatic result status. Returns null when the rule is manual (status then comes from the class teacher/admin). */
export function resultStatus(
  rule: any, o: OverallResult, items: { passRequired: boolean; r: SubjectResult }[],
): string | null {
  if (!rule || rule.mode !== 'auto') return null;
  if (!o.complete) return '—';
  const overallMin = Number(rule.overall_min ?? 33), subjectMin = Number(rule.subject_min ?? 33);
  const failedSubject = items.some((i) => i.passRequired && i.r.complete && i.r.pct < subjectMin - 1e-9);
  if (failedSubject) return rule.required_subject_fail || rule.fail || 'FAIL';
  return o.pct >= overallMin - 1e-9 ? (rule.pass || 'PASS') : (rule.fail || 'FAIL');
}

/** Annual/Final: combine results of other examinations by the configured method. */
export function annualSubject(parts: { r: SubjectResult; weight: number }[], method: string, bands: Band[]): SubjectResult {
  const cells: Cell[] = parts.map((p, i) => ({ code: String(i), max: p.r.max, v: p.r.complete ? p.r.total : null }));
  const complete = parts.length > 0 && parts.every((p) => p.r.complete);
  if (method === 'SUM') {
    const t = parts.reduce((a, p) => a + p.r.totalC, 0), m = parts.reduce((a, p) => a + p.r.maxC, 0);
    return finish(t, m, complete ? 0 : 1, cells, bands);
  }
  const W = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const pct = parts.reduce((a, p) => a + p.weight * p.r.pct, 0) / W;
  return finish(pct * 100, 10000, complete ? 0 : 1, cells, bands);
}
