import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { getCtx } from '@/lib/auth';
import { fetchAll } from '@/lib/db';
import { loadCards } from '@/lib/reportData';
import { renderCard, renderDocument } from '@/lib/reportCard';
import { logoCssForPdf } from '@/lib/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_CARDS = 60;

/** Server-side PDF. Uses the SAME renderCard() as the on-screen preview. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return new Response('Please sign in.', { status: 401 });
  if (!ctx.isAdmin) return new Response('Only administrators can generate report cards.', { status: 403 });
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
    if (!cards.length) return new Response('Nothing to print.', { status: 404 });
    const { data: settings } = await ctx.sb.from('school_settings').select('*').maybeSingle();
    let html = renderDocument(cards.map(renderCard), await logoCssForPdf(settings));
    // The preview is served by the website, but Chromium generates this PDF from
    // about:blank via page.setContent(). Root-relative image paths do not resolve
    // there, so embed both originals directly into the downloaded PDF HTML.
    const [seal, signature] = await Promise.all([
      readFile(`${process.cwd()}/public/school-seal.webp`),
      readFile(`${process.cwd()}/public/khushboo-jha-signature.webp`),
    ]);
    html = html
      .replaceAll('src="/school-seal.webp"', `src="data:image/webp;base64,${seal.toString('base64')}"`)
      .replaceAll('src="/khushboo-jha-signature.webp"', `src="data:image/webp;base64,${signature.toString('base64')}"`);
    const browser = await puppeteer.launch({
      args: chromium.args, headless: 'shell',
      executablePath: process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath()),
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '7mm', bottom: '7mm', left: '7mm', right: '7mm' } });
      const name = (cards.length === 1 ? cards[0].fileName : `${cards[0].fileName.split('_Roll-')[0]}_all`) + '.pdf';
      return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
    } finally { await browser.close(); }
  } catch (e: any) {
    return new Response(`Could not generate the PDF: ${e?.message || 'unknown error'}`, { status: 500 });
  }
}
