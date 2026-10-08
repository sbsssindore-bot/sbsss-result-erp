import { esc } from './format';
import type { Band } from './calc';

export type CardRow = { label: string; code?: string; cells: string[]; total: string; grade: string };
export type ReportCardData = {
  schoolName: string; sig: { class_teacher: string; parent: string; principal: string }; principalName?: string;
  watermark: { enabled: boolean; opacity: number };
  sessionLabel: string; examName: string; termLabel: string;
  template: { code: string; layout: any };
  scholar: string; roll: string; name: string; father: string; mother: string; classLabel: string; attendance: string;
  headers: { label: string; maxText: string }[]; hasCode: boolean; totalHeader: string;
  rows: CardRow[]; co: { label: string; grade: string }[];
  summaryLabel: string; summaryValue: string; issueDate: string; resultStatus: string;
  legend: Band[]; remarks: string; fileName: string;
};

const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

export function legendHtml(bands: Band[]) {
  const sc = [...bands].sort((a, b) => b.min - a.min);
  const range = (b: Band, i: number) => {
    const up = i === 0 ? '100' : Number.isInteger(sc[i - 1].min) ? pad2(sc[i - 1].min - 1) : String(sc[i - 1].min);
    return `${pad2(b.min)}% – ${up}%`;
  };
  return `<table class="leg"><tr>${sc.map((b, i) => `<td>${range(b, i)}</td>`).join('')}</tr><tr>${sc.map((b) => `<th>${esc(b.grade)}</th>`).join('')}</tr></table>`;
}

/** ONE template function is used by the on-screen preview AND the PDF, so they can never differ. */
export function renderCard(d: ReportCardData): string {
  const L = d.template.layout || {};
  const head = `<tr><th class="l">Subject</th>${d.hasCode ? '<th>Subject Code</th>' : ''}${d.headers.map((h) => `<th>${esc(h.label)}${h.maxText ? `<br>(${esc(h.maxText)})` : ''}</th>`).join('')}<th>${esc(d.totalHeader)}</th><th>Grade</th></tr>`;
  const body = d.rows.map((r) => `<tr><td class="l">${esc(r.label)}</td>${d.hasCode ? `<td>${esc(r.code || '')}</td>` : ''}${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}<td><b>${esc(r.total)}</b></td><td><b>${esc(r.grade)}</b></td></tr>`).join('');
  const schol = `<h4>${esc(L.scholastic_heading || '1. SCHOLASTIC ASSESSMENT')}</h4><table>${head}${body}</table>`;
  const co = L.has_co_scholastic && d.co.length
    ? `<h4>${esc(L.co_heading || '')}</h4><table><tr><th class="l">Co-Scholastic Activities / Subject Grades</th><th style="width:22%">Grade</th></tr>${d.co.map((c) => `<tr><td class="l">${esc(c.label)}</td><td>${esc(c.grade)}</td></tr>`).join('')}</table>` : '';
  const legend = `<h4>${esc(L.legend_heading || 'GRADE LEGEND')}</h4>${legendHtml(d.legend)}`;
  const summary = `<h4>${esc(L.summary_heading || 'OVERALL PERFORMANCE SUMMARY')}</h4><table><tr><td class="l" style="width:34%"><b>${esc(d.summaryLabel)}</b> ${esc(d.summaryValue)}</td><td class="l" style="width:33%"><b>Date of Issue:</b> ${esc(d.issueDate)}</td><td class="l"><b>Result Status:</b> ${esc(d.resultStatus)}</td></tr></table>`;
  const order = L.legend_after === 'summary' ? [schol, co, summary, legend]
    : L.legend_after === 'co_scholastic' ? [schol, co, legend, summary]
    : [schol, legend, summary];
  const wm = d.watermark.enabled ? `<div class="wm" style="opacity:${d.watermark.opacity}"></div>` : '';
  return `<section class="rc">${wm}<div class="hd"><div class="lg" role="img" aria-label="School logo"></div><div class="tx"><div class="sn">${esc(d.schoolName)}</div><div class="rt">${esc(d.examName.toUpperCase())} EXAMINATION REPORT CARD</div><div class="ss">ACADEMIC SESSION ${esc(d.sessionLabel)}</div></div><div class="sp"></div></div>
<table class="info"><tr><td class="k">Scholar Number:</td><td>${esc(d.scholar)}</td><td class="k">Roll Number:</td><td>${esc(d.roll)}</td></tr><tr><td class="k">Student Name:</td><td>${esc(d.name)}</td><td class="k">Class &amp; Section:</td><td>${esc(d.classLabel)}</td></tr><tr><td class="k">Father's Name:</td><td>${esc(d.father)}</td><td class="k">Mother's Name:</td><td>${esc(d.mother)}</td></tr><tr><td class="k">Attendance (Days):</td><td>${esc(d.attendance)}</td><td class="k">Academic Term:</td><td>${esc(d.termLabel)}</td></tr></table>
${order.join('')}<h4>Class Teacher's Remarks:</h4><div class="rm">${esc(d.remarks)}</div>
<div class="sg"><div>${esc(d.sig.class_teacher)}</div><div>${esc(d.sig.parent)}</div><div>${esc(d.sig.principal)}${d.principalName ? `<br><span style="font-size:9.5px">${esc(d.principalName)}</span>` : ''}</div></div></section>`;
}

export const REPORT_CSS = `
.rc{width:194mm;min-height:275mm;margin:0 auto 14px;background:#fff;color:#111;padding:8mm 9mm;font-family:Cambria,Georgia,"Times New Roman",serif;font-size:11px;line-height:1.35;border:1.4px solid #222;box-sizing:border-box;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rc>*{position:relative;z-index:1}
.rc>.wm{position:absolute;left:50%;top:53%;width:118mm;height:118mm;transform:translate(-50%,-50%);z-index:0;background:var(--logo) center/contain no-repeat;pointer-events:none}
.rc .hd{display:flex;align-items:center;gap:12px;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:8px}
.rc .hd .lg{width:72px;height:72px;flex:0 0 72px;background:var(--logo) center/contain no-repeat}
.rc .hd .sp{flex:0 0 72px}
.rc .hd .tx{flex:1;text-align:center}
.rc .sn{font-size:19px;font-weight:700;letter-spacing:.4px;line-height:1.2}
.rc .rt{font-size:13px;font-weight:700;margin-top:5px;letter-spacing:.2px}
.rc .ss{font-size:12px;font-weight:600;margin-top:2px}
.rc table{width:100%;border-collapse:collapse;margin-bottom:7px}
.rc td,.rc th{border:1px solid #333;padding:3.5px 5px;text-align:center;vertical-align:middle}
.rc th{background:rgba(236,236,236,.82);font-weight:700;font-size:10.5px}
.rc td.l,.rc th.l{text-align:left}
.rc .info td{text-align:left;padding:4px 6px}
.rc .info td.k{width:17%;font-weight:700;background:rgba(245,245,245,.8)}
.rc h4{margin:6px 0 4px;font-size:11.5px;letter-spacing:.2px}
.rc .leg td{font-size:10px;padding:3px 2px}
.rc .sg{display:flex;justify-content:space-between;gap:14px;margin-top:34px}
.rc .sg div{flex:1;text-align:center;border-top:1px solid #222;padding-top:3px;font-size:10.5px}
.rc .rm{border:1px solid #333;min-height:44px;padding:5px 7px;margin-bottom:5px}
@page{size:A4;margin:7mm}
@media print{.rc{margin:0 auto;page-break-inside:avoid}.rc:not(:last-child){page-break-after:always;break-after:page}}
`;

/** Complete standalone HTML document (used by the PDF route). `logoCss` is a CSS url(...) value. */
export function renderDocument(cards: string[], logoCss: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report cards</title><style>:root{--logo:${logoCss}}body{margin:0;background:#fff}${REPORT_CSS}</style></head><body>${cards.join('')}</body></html>`;
}
