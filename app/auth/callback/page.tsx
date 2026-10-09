
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';

export default function Callback() {
  const router = useRouter();
  const [err, setErr] = useState('');

  useEffect(() => {
    const sb = supabaseBrowser();
    const q = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(
      window.location.hash.replace(/^#/, '')
    );

    const rawNext = q.get('next') || '/set-password';
    const next =
      rawNext.startsWith('/') && !rawNext.startsWith('//')
        ? rawNext
        : '/set-password';

    let cancelled = false;

    const fail = (message: string) => {
      if (!cancelled) setErr(message);
    };

    async function handleCallback() {
      const urlError =
        hash.get('error_description') ||
        q.get('error_description') ||
        hash.get('error') ||
        q.get('error');

      if (urlError) {
        fail(
          'The authentication link was rejected or has expired. Ask the administrator for a new link.'
        );
        return;
      }

      const code = q.get('code');

      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);

        if (error) {
          fail(
            'This authentication link could not be verified. Request a new link and open it only once.'
          );
          return;
        }

        if (!cancelled) router.replace(next);
        return;
      }

      const tokenHash = q.get('token_hash');
      const rawType = q.get('type');

      const allowedTypes: EmailOtpType[] = [
        'invite',
        'recovery',
        'signup',
        'email',
        'magiclink',
        'email_change',
      ];

      if (tokenHash && rawType && allowedTypes.includes(rawType as EmailOtpType)) {
        const { error } = await sb.auth.verifyOtp({
          token_hash: tokenHash,
          type: rawType as EmailOtpType,
        });

        if (error) {
          fail(
            'This authentication link could not be verified or has expired. Ask the administrator for a new link.'
          );
          return;
        }

        if (!cancelled) router.replace(next);
        return;
      }

      // Some Supabase email links return tokens in the URL hash.
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await sb.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          fail('This authentication link could not be verified. Request a new one.');
          return;
        }

        if (!cancelled) router.replace(next);
        return;
      }

      const { data, error } = await sb.auth.getSession();

      if (!error && data.session) {
        if (!cancelled) router.replace(next);
        return;
      }

      fail(
        'No valid sign-in session was found. Request a fresh invitation or password link.'
      );
    }

    void handleCallback().catch(() => {
      fail('Could not verify this link. Please request a new one.');
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-sm">
      {err ? (
        <span className="text-red-700">{err}</span>
      ) : (
        'Verifying your link…'
      )}
    </div>
  );
}

