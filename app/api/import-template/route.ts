import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { getCtx } from '@/lib/auth';
import { TEMPLATES } from '@/lib/importTemplates';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx?.isAdmin) return new Response('Not allowed.', { status: 403 });
  const k = req.nextUrl.searchParams.get('kind') as keyof typeof TEMPLATES;
  const t = TEMPLATES[k] ?? TEMPLATES.students;
  const ws = XLSX.utils.aoa_to_sheet([[...t.head], ...t.rows.map((r) => [...r])]);
  ws['!cols'] = t.head.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  if (req.nextUrl.searchParams.get('format') === 'xlsx') {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data');
    return new Response(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${t.name}.xlsx"` } });
  }
  // UTF-8 with BOM so Excel shows Hindi names correctly
  return new Response('\uFEFF' + XLSX.utils.sheet_to_csv(ws), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.name}.csv"` } });
}
