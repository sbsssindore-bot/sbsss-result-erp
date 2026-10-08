/** Fetch every page of a PostgREST query (default cap is 1000 rows per request). */
export async function fetchAll<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}
export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
/** Turn a database/trigger error into something a school administrator can read. */
export function friendlyError(e: any): string {
  const m: string = (e && (e.message || e.details)) || String(e || 'Something went wrong.');
  if (/row-level security/i.test(m)) return 'You do not have permission to do that.';
  if (/duplicate key.*scholar_number/i.test(m)) return 'A student with this scholar number already exists.';
  if (/enrollment_roll_uq/i.test(m)) return 'That roll number is already used in this class section.';
  if (/teachers_login_id_uq/i.test(m)) return 'This Login ID is already used by another teacher.';
  if (/teachers_email_uq/i.test(m)) return 'This email is already used by another teacher.';
  if (/duplicate key/i.test(m)) return 'This record already exists.';
  if (/foreign key/i.test(m)) return 'This record is linked to other data and cannot be changed this way.';
  if (/violates check constraint/i.test(m)) return 'One of the values is not allowed.';
  if (/fetch failed|network/i.test(m)) return 'Could not reach the database. Please try again.';
  return m;
}
