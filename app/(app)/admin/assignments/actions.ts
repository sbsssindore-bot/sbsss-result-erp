
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, sessionAndExams } from "@/lib/auth";
import { friendlyError, fetchAll } from "@/lib/db";
import {
  parseIds,
  planSubjectAssignments,
} from "@/lib/assignGroups";

const done = (
  teacher: string,
  message: string,
  err = false
): never =>
  redirect(
    `/admin/assignments?teacher=${encodeURIComponent(teacher)}&${err ? "err" : "msg"}=${encodeURIComponent(message)}`
  );

export async function assignSubjectTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);

  const teacher = String(fd.get("teacher") || "");
  const mode = String(fd.get("mode") || "add");
  const selectedIds = parseIds(fd.getAll("cs"));
  const names = [
    ...new Set(
      fd
        .getAll("subj")
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  if (!teacher || !session) {
    return done(teacher, "Choose a teacher.", true);
  }

  if (!selectedIds.length || !names.length) {
    return done(
      teacher,
      "Select at least one class and one subject.",
      true
    );
  }

  if (!["skip", "add", "replace"].includes(mode)) {
    return done(teacher, "Invalid assignment mode.", true);
  }

  try {
    // The class checkbox can represent one section or
    // multiple underlying XI-XII stream sections.
    const sections = await fetchAll((a, b) =>
      sb
        .from("class_sections")
        .select(
          "id,class_id,label,section_id,stream_id,streams(name),sections(name),classes(roman)"
        )
        .eq("session_id", session.id)
        .eq("status", "ACTIVE")
        .in("id", selectedIds)
        .range(a, b)
    );

    if (!sections.length) {
      return done(
        teacher,
        "No active class sections found.",
        true
      );
    }

    const validIds = (sections as any[]).map(
      (section) => section.id
    );

    // Subjects come from the real active class_subjects
    // records. No stream dropdown or hardcoded stream choice.
    const subs = await fetchAll((a, b) =>
      sb
        .from("class_subjects")
        .select(
          "id,class_id,stream_id,display_label,kind,subjects(name)"
        )
        .eq("session_id", session.id)
        .eq("status", "ACTIVE")
        .eq("kind", "MARKS")
        .range(a, b)
    );

    const existing = await fetchAll((a, b) =>
      sb
        .from("teacher_assignments")
        .select(
          "id,teacher_id,class_section_id,class_subject_id"
        )
        .eq("session_id", session.id)
        .eq("role", "SUBJECT")
        .in("class_section_id", validIds)
        .range(a, b)
    );

    const {
      add,
      removeIds,
      skippedMissing,
      dup,
      conflicts,
    } = planSubjectAssignments({
      sections: sections as any,
      subs: subs as any,
      existing: existing as any,
      names,
      teacher,
      mode,
      session: session.id,
    });

    if (removeIds.length) {
      const { error } = await sb
        .from("teacher_assignments")
        .delete()
        .eq("session_id", session.id)
        .in("id", removeIds);

      if (error) {
        return done(teacher, friendlyError(error), true);
      }
    }

    if (add.length) {
      const { error } = await sb
        .from("teacher_assignments")
        .insert(add);

      if (error) {
        return done(teacher, friendlyError(error), true);
      }
    }

    revalidatePath("/admin/assignments");
    revalidatePath("/teacher/marks");
    revalidatePath("/marks");
    revalidatePath("/teacher");

    const messages = [`${add.length} assignment(s) added`];

    if (dup) {
      messages.push(`${dup} already existed`);
    }

    if (skippedMissing) {
      messages.push(
        `${skippedMissing} skipped because the subject is not configured for that class/stream`
      );
    }

    if (conflicts && mode === "skip") {
      messages.push(
        `${conflicts} skipped because another teacher is assigned`
      );
    }

    return done(
      teacher,
      messages.join("; ") + ".",
      add.length === 0 && dup === 0
    );
  } catch (error: any) {
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error;
    }

    return done(teacher, friendlyError(error), true);
  }
}

export async function assignClassTeacher(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);

  const teacher = String(fd.get("teacher") || "");
  const mode = String(fd.get("mode") || "skip");
  const ids = parseIds(fd.getAll("cs"));

  if (!teacher || !session) {
    return done(teacher, "Choose a teacher.", true);
  }

  if (!ids.length) {
    return done(
      teacher,
      "Select at least one class/section.",
      true
    );
  }

  if (!["skip", "replace"].includes(mode)) {
    return done(teacher, "Invalid class teacher mode.", true);
  }

  try {
    const sections = await fetchAll((a, b) =>
      sb
        .from("class_sections")
        .select("id")
        .eq("session_id", session.id)
        .eq("status", "ACTIVE")
        .in("id", ids)
        .range(a, b)
    );

    const validIds = sections.map(
      (section: any) => section.id
    );

    if (!validIds.length) {
      return done(
        teacher,
        "No active class sections found.",
        true
      );
    }

    const existing = await fetchAll((a, b) =>
      sb
        .from("teacher_assignments")
        .select("id,teacher_id,class_section_id")
        .eq("session_id", session.id)
        .eq("role", "CLASS")
        .in("class_section_id", validIds)
        .range(a, b)
    );

    const add: any[] = [];
    const removeIds: string[] = [];
    let dup = 0;
    let conflicts = 0;

    for (const id of validIds) {
      const same = existing.filter(
        (row: any) => row.class_section_id === id
      );

      if (same.some((row: any) => row.teacher_id === teacher)) {
        dup++;
        continue;
      }

      if (same.length) {
        conflicts++;

        if (mode !== "replace") continue;

        same.forEach((row: any) => removeIds.push(row.id));
      }

      add.push({
        session_id: session.id,
        teacher_id: teacher,
        class_section_id: id,
        role: "CLASS",
      });
    }

    if (removeIds.length) {
      const { error } = await sb
        .from("teacher_assignments")
        .delete()
        .eq("session_id", session.id)
        .in("id", removeIds);

      if (error) {
        return done(teacher, friendlyError(error), true);
      }
    }

    if (add.length) {
      const { error } = await sb
        .from("teacher_assignments")
        .insert(add);

      if (error) {
        return done(teacher, friendlyError(error), true);
      }
    }

    revalidatePath("/admin/assignments");
    revalidatePath("/class-entry");
    revalidatePath("/teacher");

    const message =
      `${add.length} class teacher assignment(s) added; ` +
      `${dup} already existed; ` +
      `${mode === "skip" ? `${conflicts} existing class teacher conflict(s) skipped.` : "replacement completed."}`;

    return done(
      teacher,
      message,
      add.length === 0 && dup === 0
    );
  } catch (error: any) {
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error;
    }

    return done(teacher, friendlyError(error), true);
  }
}

export async function removeAssignment(fd: FormData) {
  const { sb } = await requireAdmin();
  const { session } = await sessionAndExams(sb);
  const teacher = String(fd.get("teacher") || "");
  const ids = parseIds([String(fd.get("id") || "")]);

  if (!session || !ids.length) {
    return done(teacher, "No assignment selected.", true);
  }

  const { error } = await sb
    .from("teacher_assignments")
    .delete()
    .eq("session_id", session.id)
    .in("id", ids);

  revalidatePath("/admin/assignments");
  revalidatePath("/class-entry");
  revalidatePath("/marks");
  revalidatePath("/teacher");

  return done(
    teacher,
    error ? friendlyError(error) : "Assignment removed.",
    !!error
  );
}
