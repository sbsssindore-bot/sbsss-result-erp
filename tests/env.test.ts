import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { cleanKey, cleanSupabaseUrl } from '../lib/env';

const KEY = 'sb_publishable_TESTKEY1234567890';
test('URL/key sanitising handles real-world paste mistakes', () => {
  for (const raw of ['https://abc.supabase.co', 'https://abc.supabase.co/', ' "https://abc.supabase.co"\n', 'https://abc.supabase.co/rest/v1/', 'https://abc.supabase.co/auth/v1', 'abc.supabase.co'])
    assert.equal(cleanSupabaseUrl(raw), 'https://abc.supabase.co', JSON.stringify(raw));
  assert.equal(cleanKey(` '${KEY}'\r\n`), KEY); assert.equal(cleanSupabaseUrl(undefined), '');
});

test('sign-in works against a Supabase-like server even when env values were pasted dirty', async () => {
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.headers.apikey !== KEY) { res.statusCode = 401; return res.end(JSON.stringify({ message: 'Invalid API key' })); }
      if (req.url!.startsWith('/auth/v1/token')) {
        const b = JSON.parse(body);
        if (b.email === 'sbsssindore@gmail.com' && b.password === 'right-pass-1') return res.end(JSON.stringify({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: '5003ff47', email: b.email, aud: 'authenticated' } }));
        res.statusCode = 400; return res.end(JSON.stringify({ error_code: 'invalid_credentials', code: 400, message: 'Invalid login credentials' }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;
  // dirty on purpose: trailing slash + /rest/v1, quotes and a trailing newline in the key
  const url = cleanSupabaseUrl(` "http://127.0.0.1:${port}/rest/v1/" `), key = cleanKey(`"${KEY}"\n`);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = await sb.auth.signInWithPassword({ email: 'sbsssindore@gmail.com', password: 'right-pass-1' });
  assert.equal(ok.error, null); assert.equal(ok.data.user?.id, '5003ff47');
  const bad = await sb.auth.signInWithPassword({ email: 'sbsssindore@gmail.com', password: 'wrong' });
  assert.equal(bad.error?.code, 'invalid_credentials');
  srv.closeAllConnections(); srv.close();
});
