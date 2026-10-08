import { NextRequest } from 'next/server';
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
  if (!examId) return new Response('Missing examination.', { status: 400 });
  if (!ids.length && cs) ids = (await fetchAll((a, b) => ctx.sb.from('student_class_enrollments').select('id').eq('class_section_id', cs).eq('status', 'ACTIVE').order('roll_number').range(a, b))).map((e: any) => e.id);
  if (!ids.length) return new Response('No students selected.', { status: 400 });
  ids = ids.slice(0, MAX_CARDS);
  try {
    const cards = await loadCards(ctx.sb, examId, ids);
    if (!cards.length) return new Response('Nothing to print.', { status: 404 });
    const { data: settings } = await ctx.sb.from('school_settings').select('*').maybeSingle();
    const html = renderDocument(cards.map(renderCard), await logoCssForPdf(settings));
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
