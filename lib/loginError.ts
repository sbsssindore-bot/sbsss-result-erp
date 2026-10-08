/** Maps a Supabase Auth error to a safe, specific message. Never includes secrets. */
export const BAD_CREDENTIALS = 'Login ID or password is incorrect.';
export function loginErrorMessage(e: { message?: string; code?: string; status?: number; name?: string } | null | undefined): string {
  if (!e) return BAD_CREDENTIALS;
  const msg = String(e.message || ''), code = String(e.code || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return BAD_CREDENTIALS;
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'This account\'s email is not confirmed yet. Contact the administrator.';
  if (code === 'user_banned' || /banned/i.test(msg)) return 'This account is disabled. Contact the administrator.';
  if (code === 'over_request_rate_limit' || e.status === 429) return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  if (/invalid api key|apikey|jwt|no api key/i.test(msg) || e.status === 401 || e.status === 403)
    return 'Server configuration error: the Supabase URL/anon key on the server is wrong. (Open /api/auth-check to see what is misconfigured.)';
  if (/fetch failed|network|ENOTFOUND|ECONN|timeout/i.test(msg) || e.status === 0 || e.name === 'AuthRetryableFetchError')
    return 'Cannot reach the authentication server. Check NEXT_PUBLIC_SUPABASE_URL on the server. (Open /api/auth-check.)';
  return BAD_CREDENTIALS;
}
