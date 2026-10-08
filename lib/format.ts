export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const fmtNum = (v: number | null | undefined) => {
  if (v == null || Number.isNaN(v)) return '';
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
};
export const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
export const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));
export function todayIN() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date()).replace(/\//g, '-');
}
export function fmtDate(iso?: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}
