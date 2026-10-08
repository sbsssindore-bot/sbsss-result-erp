import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import ImportClient from '@/components/ImportClient';

const KINDS = {
  students: { kind: 'STUDENTS', title: 'Import Students', help: <>Required: scholar number, student name and class, plus a section (or a stream for XI–XII). Classes written as I, 1, Class I, 1st or Grade 1 are all understood, and sections as A, Section A or A Section. Students are grouped into class sections automatically. Date of birth: DD-MM-YYYY or YYYY-MM-DD.</> },
  teachers: { kind: 'TEACHERS', title: 'Import Teachers', help: <>Adds teachers to the Teacher Master. Required: Teacher ID and name. Add the email so you can send each teacher a login invitation, and an optional Login ID/Username. <b>Do not put passwords in the file.</b> After this, use <b>Import Assignments</b> to give each teacher their class, section and subject.</> },
  assignments: { kind: 'ASSIGNMENTS', title: 'Bulk Import Teacher Assignments', help: <>One row per assignment: Teacher ID, Academic Session, Class, Section, Subject. A teacher can have many rows. For a class teacher leave Subject empty and write <b>Class Teacher</b> in the Role column. Teachers must already exist and the class section must exist (import students first).</> },
} as const;

export default async function ImportPage({ params }: { params: { kind: string } }) {
  await requireAdmin();
  const k = KINDS[params.kind as keyof typeof KINDS];
  if (!k) notFound();
  return (
    <>
      <h1 className="h2">{k.title}</h1>
      <div className="card">
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(KINDS).map(([slug, v]) => <Link key={slug} href={`/admin/import/${slug}`} className={`rounded-md border px-4 py-2 text-sm ${slug === params.kind ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{v.title.replace('Bulk Import ', '').replace('Import ', '')}</Link>)}
        </div>
        <p className="mb-3 text-sm">{k.help}</p>
        <div className="flex flex-wrap items-center gap-2"><span className="muted">Download a sample to prepare your own data in the exact format:</span>
          {(['students', 'teachers', 'assignments'] as const).map((s) => (
            <span key={s} className="inline-flex overflow-hidden rounded-md border border-line">
              <a className={`btn btn-sm btn-ghost !rounded-none ${s === params.kind ? '!border-ink' : ''}`} href={`/api/import-template?kind=${s}&format=csv`}>Sample CSV — {s === 'assignments' ? 'Assignments' : s === 'students' ? 'Students' : 'Teachers'}</a>
              <a className="btn btn-sm btn-ghost !rounded-none" href={`/api/import-template?kind=${s}&format=xlsx`} title="Excel version">.xlsx</a></span>))}
        </div>
      </div>
      <ImportClient key={k.kind} kind={k.kind} />
    </>
  );
}
