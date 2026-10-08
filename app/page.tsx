import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export default async function Home() {
  const c = await getCtx();
  if (!c) redirect('/login');
  if (!c.profile) return <div className="p-6 text-sm">Your account is not set up yet. Please contact the administrator.</div>;
  if (c.profile.status !== 'ACTIVE') redirect('/login?error=inactive');
  redirect(c.isAdmin ? '/admin' : '/teacher');
}
