/** Turns a teacher's Login ID (or Teacher ID) into the email used by Supabase Auth. Server-side only. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
const INVISIBLE = /[\s ​-‍⁠﻿]/g;
const clean = (s: unknown) => String(s ?? '').replace(INVISIBLE, '').toLowerCase();
export const LOGIN_ID_RE = /^[A-Za-z0-9._-]{2,40}$/;

export async function resolveLoginEmail(client: any, identifier: string): Promise<string | null> {
  const id = clean(identifier);
  if (!LOGIN_ID_RE.test(id)) return null;
  for (const col of ['login_id', 'employee_id']) {
    // loose match in SQL, exact match after cleaning (tolerates stray spaces / case saved by imports)
    const { data } = await client.from('teachers').select('email,status,login_id,employee_id').ilike(col, `%${escapeLike(id)}%`).limit(25);
    const ok = (data || []).filter((t: any) => clean(t[col]) === id && t.status === 'ACTIVE' && t.email);
    if (ok.length === 1) return clean(ok[0].email);
  }
  return null;
}
