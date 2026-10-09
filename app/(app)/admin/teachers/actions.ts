
/** Send an invitation to every active teacher who has an email but no login yet. */
export async function inviteAllTeachers() {
  const { sb } = await requireAdmin();

  const { data, error } = await sb
    .from('teachers')
    .select('id, name, email')
    .is('profile_id', null)
    .eq('status', 'ACTIVE')
    .not('email', 'is', null)
    .limit(200);

  if (error) {
    return go('Could not load teachers: ' + error.message, true);
  }

  const list = data || [];

  if (!list.length) {
    return go('Every active teacher with an email already has a login.');
  }

  const admin = supabaseAdmin();
  let ok = 0;
  const fails: string[] = [];

  for (const teacher of list) {
    try {
      const { error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(teacher.email!, {
          redirectTo: redirectUrl(),
          data: { full_name: teacher.name },
        });

      if (inviteError) {
        fails.push(`${teacher.name}: ${inviteError.message}`);
      } else {
        ok++;
      }
    } catch (e: unknown) {
      fails.push(
        `${teacher.name}: ${
          e instanceof Error ? e.message : 'Unknown invitation error'
        }`
      );
    }
  }

  revalidatePath('/admin/teachers');

  const limited = fails.some((message) =>
    /rate limit|too many/i.test(message)
  );

  const result =
    `${ok} invitation(s) sent` +
    (fails.length
      ? `, ${fails.length} failed (first: ${fails[0]})`
      : '') +
    (limited
      ? '. Supabase email rate limit reached. Configure SMTP or send remaining invitations later.'
      : '');

  return go(result, ok === 0 && fails.length > 0);
}

