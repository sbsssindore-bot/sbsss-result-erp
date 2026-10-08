'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export default function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="py-2">
      {items.map((i) => {
        const on = path === i.href || (i.href !== '/admin' && i.href !== '/teacher' && path.startsWith(i.href));
        return (
          <Link key={i.href} href={i.href}
            className={`block border-l-[3px] px-5 py-3 text-sm ${on ? 'border-amber-300 bg-ink2 font-semibold text-white' : 'border-transparent text-slate-200 hover:bg-ink2'}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
