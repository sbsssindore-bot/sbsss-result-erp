
import Link from "next/link";
import { requireAdmin, sessionAndExams } from "@/lib/auth";
import { fetchAll } from "@/lib/db";
import Flash from "@/components/Flash";
import {
  groupLabel,
  groupSections,
} from "@/lib/assignGroups";
import {
  assignSubjectTeacher,
  assignClassTeacher,
  removeAssignment,
  assignGradeTeacher,
  removeGradeAssignment,
} from "./actions";

export default async function Assignments({
  searchParams,
}: {
  searchParams: {
    teacher?: string;
    msg?: string;
    err?: string;
  };
}) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);

  if (!session) return <p>No session.</p>;

  const teachers = await fetchAll((a, b) =>
    sb
      .from("teachers")
      .select("id,name,employee_id,status")
      .order("name")
      .range(a, b)
  );

  const sections = await fetchAll((a, b) =>
    sb
      .from("class_sections")
      .select(
        "id,label,class_id,section_id,stream_id,sections(name),streams(name),classes(roman)"
      )
      .eq("session_id", session.id)
      .eq("status", "ACTIVE")
      .order("class_id")
      .order("label")
      .range(a, b)
  );

  const subs = await fetchAll((a, b) =>
    sb
      .from("class_subjects")
      .select("class_id,subjects(name)")
      .eq("session_id", session.id)
      .eq("status", "ACTIVE")
      .eq("kind", "MARKS")
      .range(a, b)
  );

  const subjectNames = [
    ...new Set(
      subs
        .map((s: any) => s.subjects?.name)
        .filter(Boolean)
        .map((name: string) => name.trim())
    ),
  ].sort((a, b) => a.localeCompare(b));

  const gradeAreas = await fetchAll((a, b) =>
    sb.from("co_scholastic_areas")
      .select("id,name,display_label,class_id,session_id")
      .eq("session_id", session.id)
      .range(a, b)
  );

  const classRows = await fetchAll((a, b) =>
    sb.from("classes").select("id,roman").order("sort_order").range(a, b)
  );

  const gradeAssignments = await fetchAll((a, b) =>
    sb.from("teacher_grade_assignments").select("id,teacher_id,class_id,area_id,teachers(name),classes(roman),co_scholastic_areas(name,display_label)").eq("session_id", session.id).range(a, b)
  );

  const all = await fetchAll((a, b) =>
    sb
      .from("teacher_assignments")
      .select(
        "id,teacher_id,role,class_section_id,class_subject_id,class_sections(id,label,class_id,section_id,stream_id,sections(name),streams(name),classes(roman)),class_subjects(display_label,subjects(name)),teachers(name)"
      )
      .eq("session_id", session.id)
      .range(a, b)
  );

  const tid =
    teachers.find((t: any) => t.id === searchParams.teacher)?.id ||
    teachers[0]?.id;

  // Merge display groups with the same visible class label.
  // Keep all real class_section IDs for saving assignments.
  const rawGroups = groupSections(sections as any);
  const groupMap = new Map<string, {
    key: string;
    label: string;
    class_id: number;
    ids: string[];
    streams: string[];
  }>();

  for (const group of rawGroups) {
    const key = `${group.class_id}|${group.label.trim().toLowerCase()}`;
    const current = groupMap.get(key);

    if (current) {
      for (const id of group.ids) {
        if (!current.ids.includes(id)) current.ids.push(id);
      }
      for (const stream of group.streams) {
        if (!current.streams.includes(stream)) {
          current.streams.push(stream);
        }
      }
    } else {
      groupMap.set(key, {
        ...group,
        ids: [...group.ids],
        streams: [...group.streams],
      });
    }
  }

  const groups = [...groupMap.values()].sort(
    (a, b) =>
      a.class_id - b.class_id ||
      a.label.localeCompare(b.label)
  );

  type Row = {
    ids: string[];
    label: string;
    class_id: number;
    role: string;
    subject: string;
    streams: string[];
  };

  const collapse = (list: any[]): Row[] => {
    const map = new Map<string, Row>();

    for (const assignment of list) {
      const cs = assignment.class_sections;
      if (!cs) continue;

      const subject =
        assignment.class_subjects?.display_label ||
        assignment.class_subjects?.subjects?.name ||
        "";

      const label = groupLabel(cs);
      const key = `${cs.class_id}|${label}|${assignment.role}|${subject}`;

      const row = map.get(key) || {
        ids: [],
        label,
        class_id: cs.class_id,
        role: assignment.role,
        subject,
        streams: [],
      };

      row.ids.push(assignment.id);

      if (
        cs.stream_id &&
        cs.streams?.name &&
        !row.streams.includes(cs.streams.name)
      ) {
        row.streams.push(cs.streams.name);
      }

      map.set(key, row);
    }

    return [...map.values()].sort(
      (a, b) =>
        a.class_id - b.class_id ||
        a.label.localeCompare(b.label) ||
        a.role.localeCompare(b.role) ||
        a.subject.localeCompare(b.subject)
    );
  };

  const mine = collapse(
    (all as any[]).filter((a) => a.teacher_id === tid)
  );

  // Overview combines the same subject and teacher across
  // multiple stream-specific records into one display entry.
  const overviewMap = new Map<string, {
    label: string;
    class_id: number;
    ct: string[];
    st: string[];
  }>();

  for (const assignment of all as any[]) {
    const cs = assignment.class_sections;
    if (!cs) continue;

    const label = groupLabel(cs);
    const key = `${cs.class_id}|${label}`;

    const row = overviewMap.get(key) || {
      label,
      class_id: cs.class_id,
      ct: [],
      st: [],
    };

    const teacherName = assignment.teachers?.name || "Unknown";
    const subject =
      assignment.class_subjects?.display_label ||
      assignment.class_subjects?.subjects?.name ||
      "Subject";

    if (assignment.role === "CLASS") {
      if (!row.ct.includes(teacherName)) {
        row.ct.push(teacherName);
      }
    } else {
      const entry = `${subject}: ${teacherName}`;
      if (!row.st.includes(entry)) row.st.push(entry);
    }

    overviewMap.set(key, row);
  }

  const overview = [...overviewMap.values()].sort(
    (a, b) =>
      a.class_id - b.class_id ||
      a.label.localeCompare(b.label)
  );

  const Teacher = (
    <label className="lbl max-w-sm">
      Teacher
      <select
        className="input"
        name="teacher"
        defaultValue={tid}
        required
      >
        {teachers
          .filter(
            (t: any) => t.status === "ACTIVE" || t.id === tid
          )
          .map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.employee_id})
            </option>
          ))}
      </select>
    </label>
  );

  const ClassChoices = (
    <div className="mb-3">
      <div className="muted mb-2">
        Select one or more classes/sections.
        XI–XII selections include their underlying stream sections.
      </div>
      <div>
        {groups.map((group) => (
          <label key={group.key} className="pick">
            <input
              type="checkbox"
              name="cs"
              value={group.ids.join(",")}
            />
            {" "}{group.label}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="h2 !mb-0 flex-1">
          Teacher assignments · {session.label}
        </h1>
        <Link
          className="btn btn-sec"
          href="/admin/import/assignments"
        >
          Bulk Import Assignments
        </Link>
      </div>

      <Flash msg={searchParams.msg} err={searchParams.err} />

      <form
        method="get"
        className="card flex flex-wrap items-end gap-3"
      >
        <label className="lbl !mb-0 min-w-[240px]">
          Show assignments of
          <select
            className="input"
            name="teacher"
            defaultValue={tid}
          >
            {teachers.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.employee_id})
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sec">Show</button>
      </form>

      <form action={assignSubjectTeacher} className="card">
        <h2 className="h3">A. Subject teacher</h2>

        {Teacher}
        {ClassChoices}

        <div className="mb-3">
          <div className="muted mb-2">
            Select subjects for the selected classes. For different subjects in different classes (for example IX Maths and X English), save each class-subject combination separately.
          </div>
          <div>
            {subjectNames.map((name) => (
              <label key={name} className="pick">
                <input
                  type="checkbox"
                  name="subj"
                  value={name}
                />
                {" "}{name}
              </label>
            ))}
          </div>
        </div>

        <label className="lbl max-w-sm">
          If another teacher already teaches the same subject
          <select className="input" name="mode" defaultValue="add">
            <option value="add">Add as additional teacher</option>
            <option value="skip">Skip (keep existing teacher)</option>
            <option value="replace">Replace existing teacher</option>
          </select>
        </label>

        <button className="btn">
          Assign as subject teacher
        </button>
      </form>

      <form action={assignClassTeacher} className="card">
        <h2 className="h3">
          B. Class teacher{" "}
          <span className="muted">
            (grants Attendance & Grades access: attendance, co-scholastic grades, remarks)
          </span>
        </h2>

        {Teacher}
        {ClassChoices}

        <button className="btn btn-sec">
          Assign as class teacher — enable grades access
        </button>
      </form>

      <form action={assignGradeTeacher} className="card">
        <h2 className="h3">C. Activity grade teacher</h2>
        <p className="muted mb-3">Har class ke liye Value Education, General Knowledge, Art, Music, Dance ya configured activity ka specific teacher assign karein.</p>
        <label className="lbl max-w-sm">Teacher
          <select className="input" name="grade_teacher" required defaultValue=""><option value="" disabled>Select teacher</option>
            {teachers.filter((t: any) => t.status === "ACTIVE").map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.employee_id})</option>)}
          </select>
        </label>
        <label className="lbl max-w-sm">Class
          <select className="input" name="grade_class" required defaultValue=""><option value="" disabled>Select class</option>
            {classRows.map((cl: any) => <option key={cl.id} value={cl.id}>{cl.roman}</option>)}
          </select>
        </label>
        <label className="lbl max-w-sm">Grade / Activity
          <select className="input" name="grade_area" required defaultValue=""><option value="" disabled>Select activity</option>
            {gradeAreas.map((a: any) => <option key={a.id} value={a.id}>{a.display_label || a.name}</option>)}
          </select>
        </label>
        <button className="btn">Assign activity grades</button>
        <h3 className="h3 mt-4">Current activity grade assignments</h3>
        <div className="tw"><table className="t"><thead><tr><th>Class</th><th>Activity</th><th>Teacher</th></tr></thead><tbody>
          {gradeAssignments.map((a: any) => <tr key={a.id}><td>{a.classes?.roman || "—"}</td><td>{a.co_scholastic_areas?.display_label || a.co_scholastic_areas?.name || "—"}</td><td>{a.teachers?.name || "—"}</td></tr>)}
          {gradeAssignments.length === 0 && <tr><td colSpan={3} className="muted">No activity grade assignments yet.</td></tr>}
        </tbody></table></div>
      </form>

      <div className="card">
        <h2 className="h3">
          Current assignments of{" "}
          {teachers.find((t: any) => t.id === tid)?.name}
          {" "}({mine.length})
        </h2>

        <div className="tw">
          <table className="t">
            <thead>
              <tr>
                <th>Class</th>
                <th>Role</th>
                <th>Subject</th>
                <th>Streams</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.map((row) => (
                <tr key={row.ids.join(",")}>
                  <td>{row.label}</td>
                  <td>
                    {row.role === "SUBJECT"
                      ? "Subject teacher"
                      : <b>Class teacher</b>}
                  </td>
                  <td>{row.subject || "—"}</td>
                  <td className="muted">
                    {row.streams.join(", ") || "—"}
                  </td>
                  <td>
                    <form action={removeAssignment}>
                      <input
                        type="hidden"
                        name="id"
                        value={row.ids.join(",")}
                      />
                      <input
                        type="hidden"
                        name="teacher"
                        value={tid}
                      />
                      <button className="btn btn-sm btn-ghost">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {mine.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="h3">Who teaches what</h2>
        <div className="tw">
          <table className="t">
            <thead>
              <tr>
                <th>Class</th>
                <th>Class teacher</th>
                <th>Subject teachers</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((row) => (
                <tr key={`${row.label}-${row.class_id}`}>
                  <td>{row.label}</td>
                  <td>{row.ct.join(", ") || "—"}</td>
                  <td className="wrap">
                    {row.st.join(" · ") || "—"}
                  </td>
                </tr>
              ))}
              {overview.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
