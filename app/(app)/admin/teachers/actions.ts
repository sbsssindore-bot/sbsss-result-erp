
export async function inviteTeacher(fd: FormData) {
  const { sb } = await requireAdmin();

  const { data: tc, error: lookupError } = await sb
    .from('teachers')
    .select('id,name,email,profile_id')
    .eq('id', String(fd.get('id')))
    .single();

  if (lookupError || !tc) {
    return go('Teacher record not found. Please refresh and try again.', true);
  }

  if (!tc.email) {
    return go('Add an email address for this teacher first.', true);
  }

  if (tc.profile_id) {
    return go(
      `${tc.name} already has a login. Use “Reset password” if needed.`,
      true
    );
  }

  let failure = '';

  try {
    const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(
      tc.email,
      {
        redirectTo: redirectUrl(),
        data: { full_name: tc.name },
      }
    );

    if (error) {
      failure = /already|registered/i.test(error.message)
        ? 'This email may already have an account. Use “Reset password” to check access.'
        : error.message;
    }
  } catch (e: unknown) {
    failure =
      e instanceof Error
        ? e.message
        : 'Could not send the invitation. Please try again.';
  }

  if (failure) {
    console.error('[inviteTeacher] Invitation failed:', {
      teacherId: tc.id,
      email: tc.email,
      reason: failure,
    });

    return go(failure, true);
  }

  revalidatePath('/admin/teachers');
  return go(`Invitation sent to ${tc.email}.`);
}
