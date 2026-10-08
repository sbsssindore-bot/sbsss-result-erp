import NavLinks from './NavLinks';
import { signOut } from '@/app/actions/auth';

export default function Shell({ nav, name, role, children }: { nav: { href: string; label: string }[]; name: string; role: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <input type="checkbox" id="menu" className="peer hidden" />
      <label htmlFor="menu" className="fixed inset-0 z-30 hidden bg-black/40 peer-checked:block md:!hidden" aria-label="Close menu" />
      <aside className="fixed inset-y-0 left-0 z-40 w-60 -translate-x-full overflow-y-auto bg-ink text-slate-200 transition-transform peer-checked:translate-x-0 md:sticky md:top-0 md:h-screen md:translate-x-0">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <img src="/sbsss-logo.png" alt="" className="h-10 w-10 rounded bg-white object-contain p-0.5" />
          <div className="text-xs font-semibold leading-tight text-white">SBSSS<br /><span className="font-normal text-slate-300">Result ERP</span></div>
        </div>
        <NavLinks items={nav} />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
          <label htmlFor="menu" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-line text-xl md:hidden" aria-label="Open menu">☰</label>
          <div className="min-w-0 flex-1 truncate text-sm"><b>{name}</b> <span className="chip ml-1">{role}</span></div>
          <form action={signOut}><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
        </header>
        <main className="mx-auto w-full max-w-6xl p-4 pb-24">{children}</main>
      </div>
    </div>
  );
}
