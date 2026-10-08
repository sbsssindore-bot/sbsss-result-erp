/** Turns a teacher's Login ID (or Teacher ID) into the email used by Supabase Auth. Server-side only. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
export const LOGIN_ID_RE = /^[A-Za-z0-9._-]{2,40}$/;

export async function resolveLoginEmail(client: any, identifier: string): Promise<string | null> {
  const id = identifier.trim();
  if (!LOGIN_ID_RE.test(id)) return null;
  for (const col of ['login_id', 'employee_id']) {
    const { data } = await client.from('teachers').select('email,status').ilike(col, escapeLike(id)).limit(2);
    const ok = (data || []).filter((t: any) => t.status === 'ACTIVE' && t.email);
    if (ok.length === 1) return String(ok[0].email).toLowerCase();
  }
  return null;
}
