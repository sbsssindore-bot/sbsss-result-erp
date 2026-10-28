import { NextRequest } from 'next/server';
import { getCtx } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import { loadCards } from '@/lib/reportData';
import { renderCard, renderDocument } from '@/lib/reportCard';
import { logoCssForPdf } from '@/lib/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_CARDS = 60;

/** Word-compatible report card download using the same HTML/CSS template as the PDF. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return new Response('Please sign in.', { status: 401 });
  if (!ctx.isAdmin) return new Response('Only administrators can download report cards.', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const examId = sp.get('exam') || '';
  let ids = (sp.get('ids') || '').split(',').filter(Boolean);
  const cs = sp.get('cs');
  const classIdRaw = sp.get('class_id');
  if (!examId) return new Response('Missing examination.', { status: 400 });

  if (!ids.length && classIdRaw) {
    const classId = Number(classIdRaw);
    if (!Number.isInteger(classId) || classId < 1 || classId > 12) return new Response('Invalid class.', { status: 400 });
    const { data: exam, error } = await ctx.sb.from('examinations').select('session_id').eq('id', examId).maybeSingle();
    if (error) return new Response(error.message, { status: 500 });
    if (!exam) return new Response('Examination not found.', { status: 404 });
    const sections = await fetchAll((a, b) => ctx.sb.from('class_sections').select('id').eq('session_id', exam.session_id).eq('class_id', classId).eq('status', 'ACTIVE').range(a, b));
    const sectionIds = sections.map((s: any) => s.id);
    if (sectionIds.length) ids = (await fetchAll((a, b) => ctx.sb.from('student_class_enrollments').select('id,roll_number').in('class_section_id', sectionIds).eq('status', 'ACTIVE').order('roll_number').range(a, b))).map((e: any) => e.id);
  } else if (!ids.length && cs) {
    ids = (await fetchAll((a, b) => ctx.sb.from('student_class_enrollments').select('id').eq('class_section_id', cs).eq('status', 'ACTIVE').order('roll_number').range(a, b))).map((e: any) => e.id);
  }
  if (!ids.length) return new Response('No students selected.', { status: 400 });
  ids = ids.slice(0, MAX_CARDS);

  try {
    const cards = await loadCards(ctx.sb, examId, ids);
    if (!cards.length) return new Response('Nothing to download.', { status: 404 });
    const { data: settings } = await ctx.sb.from('school_settings').select('*').maybeSingle();
    const logoCss = await logoCssForPdf(settings);
    // Word opens this HTML document from a downloaded local file, so root-relative
    // image URLs ("/school-seal.webp") resolve to the local disk and show broken icons.
    // Use absolute public asset URLs in the Word-compatible export.
    const assetBase = req.nextUrl.origin;
    const html = renderDocument(cards.map(renderCard), logoCss)
      .replaceAll('src="/school-seal.webp"', `src="${assetBase}/school-seal.webp"`)
      .replaceAll('src="/khushboo-jha-signature.webp"', `src="${assetBase}/khushboo-jha-signature.webp"`)
      .replace('</head>', '<meta name="ProgId" content="Word.Document"><meta name="Generator" content="SBSSS Result ERP"><style>html,body{background:#fff!important}body{font-family:Cambria,Georgia,"Times New Roman",serif}.rc{page-break-after:always;break-after:page;margin:0 auto!important}.rc:last-child{page-break-after:auto;break-after:auto}table{mso-table-lspace:0pt;mso-table-rspace:0pt}td,th{mso-padding-alt:3.5pt 5pt}</style></head>');
    const name = (cards.length === 1 ? cards[0].fileName : `${cards[0].fileName.split('_Roll-')[0]}_all`) + '.doc';
    return new Response(html, {
      headers: {
        'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response(`Could not generate the Word document: ${e?.message || 'unknown error'}`, { status: 500 });
  }
}
