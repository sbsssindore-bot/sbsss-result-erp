
import Link from "next/link";
import { requireAdmin, sessionAndExams } from "@/lib/auth";
import { fetchAll } from "@/lib/db";
import Flash from "@/components/Flash";
import {
  groupKey,
  groupLabel,
  groupSections,
} from "@/lib/assignGroups";
import {
  assignSubjectTeacher,
  assignClassTeacher,
  removeAssignment,
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

  const groups = groupSections(sections as any);

  type AssignmentRow = {
    ids: string[];
    label: string;
    class_id: number;
    role: string;
    subject: string;
    streams: string[];
  };

  const collapse = (list: any[]): AssignmentRow[] => {
    const map = new Map<string, AssignmentRow>();

    for (const assignment of list) {
      const cs = assignment.class_sections;
      if (!cs) continue;

      const subject =
        assignment.class_subjects?.display_label ||
        assignment.class_subjects?.subjects?.name ||
        "";

      const key = `${groupKey(cs)}|${assignment.role}|${subject}`;

      const row = map.get(key) || {
        ids: [],
        label: groupLabel(cs),
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

  const overviewMap = new Map<
    string,
    {
      label: string;
      class_id: number;
      ct: string[];
      st: string[];
    }
  >();

  (all as any[]).forEach((assignment) => {
    const cs = assignment.class_sections;
    if (!cs) return;

    const key = groupKey(cs);

    const row = overviewMap.get(key) || {
      label: groupLabel(cs),
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
      if (!row.ct.includes(teacherName)) row.ct.push(teacherName);
    } else {
      const description =
        `${subject}` +
        `${cs.stream_id && cs.streams?.name ? ` [${cs.streams.name}]` : ""}: ${teacherName}`;

      if (!row.st.includes(description)) row.st.push(description);
    }

    overviewMap.set(key, row);
  });

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
        Select class/sections. For XI–XII, select XI-A or XII-A
        normally; the stream dropdown below determines which
        stream receives the subject assignment.
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

  const ClassTeacherChoices = (
    <div className="mb-3">
      <div className="muted mb-2">
        Select the whole class/section. For XI–XII, one selection
        covers every underlying stream section.
      </div>

      <div>
        {groups.map((group) => (
          <label
            key={group.key}
            className="pick"
            title={
              group.streams.length
                ? `Includes: ${group.streams.join(", ")}`
                : undefined
            }
          >
            <input
              type="checkbox"
              name="cs"
              value={group.ids.join(",")}
            />
            {" "}{group.label}
            {group.ids.length > 1 && (
              <span className="muted">
                {" "}(all streams)
              </span>
            )}
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

        <label className="lbl max-w-sm">
          Stream (required for XI–XII)
          <select
            className="input"
            name="streamCategory"
            defaultValue=""
          >
            <option value="">Select stream if applicable</option>
            <option value="Science">Science (PCM / PCB)</option>
            <option value="Commerce">Commerce</option>
            <option value="Humanities/Arts">Humanities/Arts</option>
          </select>
        </label>

        <div className="mb-3 mt-3">
          <div className="muted mb-2">
            Individual subjects — select the subjects this teacher
            teaches. The system will match available class subjects.
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

        <button className="btn">Assign as subject teacher</button>
      </form>

      <form action={assignClassTeacher} className="card">
        <h2 className="h3">
          B. Class teacher{" "}
          <span className="muted">
            (attendance, co-scholastic grades, remarks)
          </span>
        </h2>

        {Teacher}
        {ClassTeacherChoices}

        <label className="lbl max-w-sm">
          If the class already has a class teacher
          <select className="input" name="mode" defaultValue="skip">
            <option value="skip">Skip</option>
            <option value="replace">Replace</option>
          </select>
        </label>

        <button className="btn btn-sec">
          Assign as class teacher
        </button>
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
