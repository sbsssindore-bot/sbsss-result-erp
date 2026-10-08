import { promises as fs } from 'fs';
import path from 'path';

/** URL the browser should use for the school logo (custom upload or the built-in SBSSS logo). */
export function logoUrl(settings: any): string {
  if (settings?.logo_path) return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${settings.logo_path}`;
  return '/sbsss-logo.png';
}
/** CSS url(...) with the logo embedded, so the generated PDF never depends on the network. */
export async function logoCssForPdf(settings: any): Promise<string> {
  let buf: Buffer; let mime = 'image/png';
  try {
    if (settings?.logo_path) {
      const r = await fetch(logoUrl(settings));
      if (!r.ok) throw new Error('logo fetch failed');
      mime = r.headers.get('content-type') || 'image/png';
      buf = Buffer.from(await r.arrayBuffer());
    } else throw new Error('default');
  } catch {
    buf = await fs.readFile(path.join(process.cwd(), 'public', 'sbsss-logo.png')); mime = 'image/png';
  }
  return `url("data:${mime};base64,${buf.toString('base64')}")`;
}
