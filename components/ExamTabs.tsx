import Link from 'next/link';
export default function ExamTabs({ exams, current, base, params = {} }: { exams: any[]; current?: string; base: string; params?: Record<string, string | undefined> }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {exams.map((e) => {
        const sp = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => v && sp.set(k, v));
        sp.set('exam', e.id);
        return (
          <Link key={e.id} href={`${base}?${sp.toString()}`}
            className={`rounded-md border px-3 py-2 text-sm ${e.id === current ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{e.name}</Link>
        );
      })}
    </div>
  );
}
