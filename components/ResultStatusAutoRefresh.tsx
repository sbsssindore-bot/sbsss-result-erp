'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh the server-rendered class result statuses periodically while the dashboard stays open. */
export default function ResultStatusAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [router]);

  return <p className="muted mb-3 text-xs">Status auto-refreshes every 10 seconds while this page is open.</p>;
}
