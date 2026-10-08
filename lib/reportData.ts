import { chunk, fetchAll } from './db';
import { ROMAN, f2, fmtDate, fmtNum, todayIN } from './format';
import { annualSubject, overallResult, resultStatus, subjectResult, type Band, type Comp, type MarkVal, type SubjectResult } from './calc';
import type { ReportCardData, CardRow } from './reportCard';

const IDS = 40; // ids per `in (...)` request keeps URLs short

async function byIds(sb: any, table: string, col: string, ids: string[], extra?: (q: any) => any) {
  const out: any[] = [];
  for (const part of chunk(Array.from(new Set(ids)), IDS)) {
    out.push(...(await fetchAll((a, b) => {
      let q = sb.from(table).select('*').in(col, part);
      if (extra) q = extra(q);
      return q.range(a, b);
    })));
  }
  return out;
}
async function one(sb: any, table: string, id: string) {
  const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Build everything a report card needs. All figures come from the calculation engine (lib/calc). */
export async function loadCards(sb: any, examId: string, enrollmentIds: string[]): Promise<ReportCardData[]> {
  const exam = await one(sb, 'examinations', examId);
  if (!exam) throw new Error('Examination not found.');
  const session = await one(sb, 'academic_sessions', exam.session_id);
  const { data: settings } = await sb.from('school_settings').select('*').maybeSingle();
  const bands: Band[] = (await fetchAll((a, b) => sb.from('grade_scale_bands').select('*').eq('scale_id', exam.grade_scale_id).range(a, b)))
    .map((x: any) => ({ grade: x.grade, min: Number(x.min_percentage) }));
  const rule = exam.result_rule_id ? (await one(sb, 'result_rules', exam.result_rule_id))?.rule : null;
  const templates = await fetchAll((a, b) => sb.from('report_card_templates').select('*').range(a, b));

  // sources for an Annual exam
  let srcExams: any[] = [{ id: examId, name: exam.name, weight: 1 }];
  let method = 'WEIGHTED';
  if (exam.type === 'ANNUAL') {
    const { data: ar } = await sb.from('annual_rules').select('*').eq('examination_id', examId).maybeSingle();
    method = ar?.method || 'WEIGHTED';
    const srcs = ar ? await fetchAll((a, b) => sb.from('annual_rule_sources').select('*').eq('rule_id', ar.id).range(a, b)) : [];
    const exs = await byIds(sb, 'examinations', 'id', srcs.map((s: any) => s.source_examination_id));
    srcExams = srcs.map((s: any) => ({ id: s.source_examination_id, name: exs.find((e: any) => e.id === s.source_examination_id)?.name || '', weight: Number(s.weight) }))
      .sort((x: any, y: any) => (exs.find((e: any) => e.id === x.id)?.sequence || 0) - (exs.find((e: any) => e.id === y.id)?.sequence || 0));
  }
  const examIds = srcExams.map((s) => s.id);

  const enrollments = await byIds(sb, 'student_class_enrollments', 'id', enrollmentIds);
  const students = await byIds(sb, 'students', 'id', enrollments.map((e) => e.student_id));
  const classSections = await byIds(sb, 'class_sections', 'id', enrollments.map((e) => e.class_section_id));
  const classSubjects = await fetchAll((a, b) => sb.from('class_subjects').select('*').eq('session_id', exam.session_id).eq('status', 'ACTIVE').range(a, b));
  const groups = await fetchAll((a, b) => sb.from('subject_groups').select('*').range(a, b));
  const subjects = await byIds(sb, 'subjects', 'id', classSubjects.map((c: any) => c.subject_id));
  const codeOf = (cs: any) => (subjects.find((x: any) => x.id === cs.subject_id)?.code || '');
  const choices = await byIds(sb, 'student_subject_choices', 'enrollment_id', enrollmentIds);
  const components: any[] = [];
  for (const id of examIds) components.push(...await fetchAll((a, b) => sb.from('exam_components').select('*').eq('examination_id', id).range(a, b)));
  const limits = await byIds(sb, 'exam_component_limits', 'class_subject_id', classSubjects.map((c: any) => c.id));
  const marks: any[] = [];
  for (const id of examIds) for (const part of chunk(enrollmentIds, 15)) {
    marks.push(...await fetchAll((a, b) => sb.from('marks').select('*').eq('examination_id', id).in('enrollment_id', part).range(a, b)));
  }
  const areas = await fetchAll((a, b) => sb.from('co_scholastic_areas').select('*').eq('session_id', exam.session_id).range(a, b));
  const coMarks = await byIds(sb, 'co_scholastic_marks', 'enrollment_id', enrollmentIds, (q) => q.eq('examination_id', examId));
  const attendance = await byIds(sb, 'attendance', 'enrollment_id', enrollmentIds, (q) => q.eq('examination_id', examId));
  const remarks = await byIds(sb, 'report_remarks', 'enrollment_id', enrollmentIds, (q) => q.eq('examination_id', examId));

  const markKey = new Map<string, any>(marks.map((m) => [`${m.enrollment_id}|${m.examination_id}|${m.class_subject_id}|${m.component_id}`, m]));
  const limitKey = new Map<string, any>(limits.map((l) => [`${l.class_subject_id}|${l.component_id}`, l]));
  const choiceKey = new Map<string, string>(choices.map((c) => [`${c.enrollment_id}|${c.subject_group_id}`, c.class_subject_id]));
  const coKey = new Map<string, any>(coMarks.map((c) => [`${c.enrollment_id}|${c.area_id}`, c]));
  const attKey = new Map<string, any>(attendance.map((c) => [c.enrollment_id, c]));
  const remKey = new Map<string, any>(remarks.map((c) => [c.enrollment_id, c]));

  const compsFor = (xid: string, tplCode: string, cs: any): (Comp & { id: string })[] =>
    components.filter((c) => c.examination_id === xid && c.template_code === tplCode)
      .sort((a, b) => a.display_order - b.display_order)
      .flatMap((c) => {
        const l = limitKey.get(`${cs.id}|${c.id}`);
        if (l && l.is_applicable === false) return [];
        return [{ id: c.id, code: c.code, label: c.label, max: Number(l && l.max_marks != null ? l.max_marks : c.max_marks) }];
      });

  const subjResult = (enrId: string, tplCode: string, cs: any): SubjectResult => {
    const per = srcExams.map((s) => {
      const cps = compsFor(s.id, tplCode, cs);
      const vals: Record<string, MarkVal> = {};
      for (const c of cps) {
        const m = markKey.get(`${enrId}|${s.id}|${cs.id}|${c.id}`);
        vals[c.code] = !m ? null : m.is_absent ? 'AB' : m.value == null ? null : Number(m.value);
      }
      return { r: subjectResult(cps, vals, bands), weight: s.weight };
    });
    return exam.type === 'ANNUAL' ? annualSubject(per, method, bands) : per[0].r;
  };

  const today = todayIN();
  const wm = settings?.watermark || { enabled: true, opacity: 0.06 };
  const sig = settings?.signature_labels || { class_teacher: 'Class Teacher Signature', parent: 'Parent / Guardian Signature', principal: 'Principal Signature' };
  const annual = exam.type === 'ANNUAL';
  const cards: ReportCardData[] = [];

  for (const enrId of enrollmentIds) {
    const en = enrollments.find((e) => e.id === enrId);
    if (!en) continue;
    const st = students.find((s) => s.id === en.student_id);
    const cs = classSections.find((c) => c.id === en.class_section_id);
    if (!st || !cs) continue;
    const cls = cs.class_id as number;
    const tpl = templates.find((t: any) => cls >= t.min_class && cls <= t.max_class);
    if (!tpl) continue;
    const layout = tpl.layout || {};
    const classSubs = classSubjects.filter((c: any) => c.class_id === cls);
    const scholastic = classSubs.filter((c: any) => c.kind === 'MARKS');

    let shown: { cs: any | null; label: string }[];
    if (layout.subject_slots) {
      shown = groups.filter((g: any) => g.template_code === tpl.code).sort((a: any, b: any) => a.slot_no - b.slot_no).map((g: any) => ({
        cs: classSubs.find((x: any) => x.id === choiceKey.get(`${enrId}|${g.id}`)) || null, label: g.label }));
    } else {
      shown = scholastic.filter((c: any) => !c.subject_group_id).sort((a: any, b: any) => a.display_order - b.display_order)
        .map((c: any) => ({ cs: c, label: c.display_label }));
    }

    const baseComps = components.filter((c) => c.examination_id === examIds[0] && c.template_code === tpl.code).sort((a, b) => a.display_order - b.display_order);
    const headers = annual
      ? srcExams.map((s) => ({ label: s.name, maxText: '' }))
      : baseComps.map((bc) => {
          const maxes = new Set<number>();
          for (const c of scholastic) { const x = compsFor(examIds[0], tpl.code, c).find((k) => k.code === bc.code); if (x) maxes.add(x.max); }
          return { label: bc.label, maxText: [...maxes].sort((a, b) => b - a).map(fmtNum).join('/') };
        });
    const totalMax = annual ? (method === 'SUM' ? '' : '100')
      : fmtNum(Math.max(0, ...scholastic.map((c: any) => compsFor(examIds[0], tpl.code, c).reduce((a, k) => a + k.max, 0))));

    const items: { inOverall: boolean; passRequired: boolean; r: SubjectResult }[] = [];
    const rows: CardRow[] = shown.map(({ cs: sub, label }) => {
      if (!sub) return { label, code: '', cells: headers.map(() => ''), total: '', grade: '' };
      const r = subjResult(enrId, tpl.code, sub);
      items.push({ inOverall: sub.include_in_overall, passRequired: sub.pass_required, r });
      const cells = annual
        ? srcExams.map((_, i) => (r.cells[i] && r.cells[i].v != null ? fmtNum(r.cells[i].v as number) : ''))
        : baseComps.map((bc) => {
            const k = r.cells.find((z) => z.code === bc.code);
            return k ? (k.v === 'AB' ? 'AB' : k.v == null ? '—' : fmtNum(k.v as number)) : '—';
          });
      return {
        label: layout.subject_slots ? sub.display_label : label, code: codeOf(sub), cells,
        total: r.complete ? fmtNum(annual ? +(r.totalC / 100).toFixed(2) : r.total) : '', grade: r.complete ? r.grade : '',
      };
    });

    const slotMissing = !!layout.subject_slots && shown.some((x) => !x.cs);
    const o = overallResult(items, bands, slotMissing);
    const att = attKey.get(enrId), rem = remKey.get(enrId);
    const auto = resultStatus(rule, o, items);
    const status = auto != null ? auto : rem?.result_status || '—';
    const marksCard = ['A', 'B', 'C'].includes(tpl.code);
    const pctTxt = o.maxC ? `${f2(o.pct)}%${o.complete ? '' : ' (incomplete)'}` : '—';

    const areasFor = areas.filter((x: any) => x.class_id === cls).sort((a: any, b: any) => a.display_order - b.display_order);
    cards.push({
      schoolName: settings?.school_name || 'SCHOOL', principalName: settings?.principal_name || '', sig, watermark: { enabled: !!wm.enabled, opacity: Number(wm.opacity ?? 0.06) },
      sessionLabel: session.label, examName: exam.display_name || exam.name, termLabel: exam.term_label || exam.name,
      template: { code: tpl.code, layout },
      scholar: st.scholar_number, roll: en.roll_number == null ? '' : String(en.roll_number), name: st.name,
      father: st.father_name || '', mother: st.mother_name || '', classLabel: cs.label,
      attendance: att && att.present_days != null ? fmtNum(Number(att.present_days)) : '',
      headers, hasCode: !!layout.subject_code_column, totalHeader: `${annual ? 'Annual' : 'Total'}${totalMax ? ` (${totalMax})` : ''}`,
      rows, co: areasFor.map((a: any) => ({ label: a.display_label || a.name, grade: coKey.get(`${enrId}|${a.id}`)?.grade || '' })),
      summaryLabel: layout.summary_label || 'Percentage:',
      summaryValue: marksCard && o.maxC ? `${fmtNum(o.total)} / ${fmtNum(o.max)}  (${pctTxt})` : pctTxt,
      issueDate: settings?.issue_date ? fmtDate(settings.issue_date) : today, resultStatus: status,
      legend: bands, remarks: rem?.remarks || '',
      fileName: `${session.label}_${String(exam.name).replace(/\s+/g, '-')}_Class-${ROMAN[cls]}_${cs.label.replace(/^[IVX]+[ -]*/, '').replace(/\s+/g, '') || 'A'}_Roll-${String(en.roll_number ?? 0).padStart(2, '0')}_${String(st.name).replace(/[^A-Za-z0-9]+/g, '')}`,
    });
  }
  return cards;
}
