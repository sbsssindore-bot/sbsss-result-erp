/** Mirrors app.normalize_class / normalize_section / normalize_stream in the database. */
const ROMAN_MAP: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

export function normalizeClass(t: unknown): number | null {
  if (t == null) return null;
  let s = String(t).toLowerCase().trim();
  s = s.replace(/(class|grade|standard|std|cl)\.?/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  s = s.replace(/^(\d+)(st|nd|rd|th)$/, '$1');
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n >= 1 && n <= 12 ? n : null; }
  return ROMAN_MAP[s] ?? null;
}
export function normalizeSection(t: unknown): string | null {
  if (t == null) return null;
  const s = String(t).toUpperCase().trim().replace(/SECTION|SEC/g, '').replace(/[^A-Z0-9]/g, '');
  return s || null;
}
export function normalizeStream(t: unknown): string | null {
  if (t == null) return null;
  const raw = String(t).trim();
  const s = raw.toLowerCase();
  if (!s) return null;
  if (s.startsWith('sci')) return 'Science';
  if (s.startsWith('com')) return 'Commerce';
  if (s.startsWith('art') || s.startsWith('human')) return 'Arts';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}
export function normalizeSessionLabel(t: unknown): string | null {
  if (t == null) return null;
  const s = String(t).trim().replace(/[–—]/g, '-');
  if (!s) return null;
  const m = s.match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!m) return s;
  return `${m[1]}-${m[2].slice(-2)}`;
}
export function normalizeGender(t: unknown): string | null {
  const s = String(t ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['m', 'male', 'boy', 'b'].includes(s)) return 'M';
  if (['f', 'female', 'girl', 'g'].includes(s)) return 'F';
  return 'O';
}
export function normalizeDate(t: unknown): string | null {
  if (t == null || t === '') return null;
  if (t instanceof Date) return isNaN(+t) ? null : t.toISOString().slice(0, 10);
  if (typeof t === 'number') { // Excel serial date
    const d = new Date(Math.round((t - 25569) * 86400 * 1000));
    return isNaN(+d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(t).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
