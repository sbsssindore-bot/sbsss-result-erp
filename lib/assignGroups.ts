
export type Sec = {
  id: string;
  class_id: number;
  label: string;
  section_id?: string | null;
  stream_id?: string | null;
  sections?: { name?: string } | null;
  streams?: { name?: string } | null;
  classes?: { roman?: string } | null;
};

export type Group = {
  key: string;
  label: string;
  class_id: number;
  ids: string[];
  streams: string[];
};

export type Sub = {
  id: string;
  class_id: number;
  stream_id?: string | null;
  display_label?: string;
  subjects?: { name?: string } | null;
};

export function groupLabel(s: Sec): string {
  if (!s.stream_id) return s.label;
  const roman = s.classes?.roman || String(s.label).split(/[\s-]/)[0];
  const section = s.sections?.name;
  return section ? `${roman}-${section}` : roman;
}

export const groupKey = (s: Sec) => {
  if (s.stream_id) {
    return `${s.class_id}|${s.section_id || s.sections?.name || ""}`;
  }
  if (s.section_id) {
    return `${s.class_id}|${s.section_id}`;
  }
  return `${s.class_id}|label:${s.label.trim().toLowerCase()}`;
};

export function groupSections(secs: Sec[]): Group[] {
  const groups = new Map<string, Group>();

  for (const s of secs) {
    const key = groupKey(s);
    const existing = groups.get(key);

    if (existing) {
      if (!existing.ids.includes(s.id)) existing.ids.push(s.id);
      if (s.stream_id && s.streams?.name && !existing.streams.includes(s.streams.name)) {
        existing.streams.push(s.streams.name);
      }
      continue;
    }

    groups.set(key, {
      key,
      label: groupLabel(s),
      class_id: s.class_id,
      ids: [s.id],
      streams: s.stream_id && s.streams?.name ? [s.streams.name] : [],
    });
  }

  return [...groups.values()].sort(
    (a, b) => a.class_id - b.class_id || a.label.localeCompare(b.label)
  );
}

export function parseIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    for (const part of String(value).split(",")) {
      const id = part.trim();
      if (/^[0-9a-f-]{36}$/i.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

export function normalizeStreamName(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

export type StreamCategory = "Science" | "Commerce" | "Humanities/Arts";

export function streamMatchesCategory(streamName: unknown, category: string): boolean {
  const name = normalizeStreamName(streamName);

  if (category === "Science") {
    return ["science", "pcm", "pcb", "pcmandpe", "pcbpandpe", "pcbppe", "pcbandpe"].includes(name);
  }
  if (category === "Commerce") return name === "commerce";
  if (category === "Humanities/Arts") {
    return name.includes("humanit") || name.includes("hument") || name === "arts";
  }
  return false;
}

export type Existing = {
  id: string;
  teacher_id: string;
  class_section_id: string;
  class_subject_id: string;
};

export function pickSubject(subs: Sub[], section: Sec, nameLower: string): Sub | undefined {
  const named = subs.filter((subject) => {
    if (subject.class_id !== section.class_id) return false;
    const subjectName = String(subject.subjects?.name || "").trim().toLowerCase();
    const displayName = String(subject.display_label || "").trim().toLowerCase();
    return subjectName === nameLower || displayName === nameLower;
  });

  if (!section.stream_id) return named.find((s) => !s.stream_id) || named[0];

  const streamSpecific = named.find((s) => s.stream_id === section.stream_id);
  if (streamSpecific) return streamSpecific;

  const common = named.find((s) => !s.stream_id);
  if (common) return common;

  const hasStreamSubjects = subs.some(
    (s) => s.class_id === section.class_id && s.stream_id === section.stream_id
  );

  return hasStreamSubjects ? undefined : named[0];
}

export function planSubjectAssignments(p: {
  sections: Sec[];
  subs: Sub[];
  existing: Existing[];
  names: string[];
  teacher: string;
  mode: string;
  session: string;
}) {
  const add: any[] = [];
  const removeIds: string[] = [];
  let skippedMissing = 0;
  let dup = 0;
  let conflicts = 0;

  for (const section of p.sections) {
    for (const name of p.names) {
      const subject = pickSubject(p.subs, section, name.trim().toLowerCase());
      if (!subject) {
        skippedMissing++;
        continue;
      }

      const existing = p.existing.filter(
        (row) => row.class_section_id === section.id && row.class_subject_id === subject.id
      );

      if (existing.some((row) => row.teacher_id === p.teacher)) {
        dup++;
        continue;
      }

      if (existing.length) {
        conflicts++;
        if (p.mode === "skip") continue;
        if (p.mode === "replace") existing.forEach((row) => removeIds.push(row.id));
      }

      add.push({
        session_id: p.session,
        teacher_id: p.teacher,
        class_section_id: section.id,
        class_subject_id: subject.id,
        role: "SUBJECT",
      });
    }
  }

  return {
    add,
    removeIds: [...new Set(removeIds)],
    skippedMissing,
    dup,
    conflicts,
  };
}


