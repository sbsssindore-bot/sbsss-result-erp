
export const groupKey = (s: Sec) => {
  // Stream sections belonging to the same class and
  // section must appear as one group (e.g. XII-A).
  if (s.stream_id) {
    return `${s.class_id}|${s.section_id || s.sections?.name || ""}`;
  }

  // A non-stream section may share the same group as
  // stream sections when class_id + section match.
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
      if (!existing.ids.includes(s.id)) {
        existing.ids.push(s.id);
      }

      if (
        s.stream_id &&
        s.streams?.name &&
        !existing.streams.includes(s.streams.name)
      ) {
        existing.streams.push(s.streams.name);
      }

      continue;
    }

    groups.set(key, {
      key,
      label: groupLabel(s),
      class_id: s.class_id,
      ids: [s.id],
      streams:
        s.stream_id && s.streams?.name
          ? [s.streams.name]
          : [],
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.class_id - b.class_id ||
      a.label.localeCompare(b.label)
  );
}

