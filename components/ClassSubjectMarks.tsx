'use client';

type Student = { id: string; roll: number | null; name: string };
type Subject = { id: string; display_label: string };
type Mark = { enrollment_id: string; class_subject_id: string; value: number | null; is_absent: boolean | null };

export default function ClassSubjectMarks({ students, subjects, marks }: {
  students: Student[]; subjects: Subject[]; marks: Mark[];
}) {
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return <div className="tw"><table className="t">
    <thead><tr><th className="sticky left-0 z-10 bg-slate-100">Student</th>{subjects.map((s) => <th key={s.id} className="text-center">{s.display_label}</th>)}</tr></thead>
    <tbody>{students.map((student) => <tr key={student.id}>
      <td className="sticky left-0 z-[1] min-w-[150px] bg-white shadow-[1px_0_0_#D8DEE8]"><b>{student.roll ?? '—'}</b> {student.name}</td>
      {subjects.map((subject) => {
        const rows = marks.filter((m) => m.enrollment_id === student.id && m.class_subject_id === subject.id);
        const values = rows.filter((m) => m.is_absent !== true && m.value != null).map((m) => Number(m.value));
        const hasAbsent = rows.some((m) => m.is_absent === true);
        return <td key={subject.id} className="text-center">{!rows.length ? '—' : hasAbsent && values.length === 0 ? 'AB' : fmt(values.reduce((a, b) => a + b, 0))}</td>;
      })}
    </tr>)}
    {students.length === 0 && <tr><td colSpan={subjects.length + 1} className="muted">No students in this class section.</td></tr>}</tbody>
  </table></div>;
}
