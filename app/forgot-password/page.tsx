'use client';
import Link from 'next/link';

export default function ForgotPassword() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6">
        <h1 className="h2">Forgot password?</h1>
        <p className="mb-4 text-sm text-slate-600">
          Please contact the ERP administrator to reset your password. The administrator
          can set a new password without sending an email. You can then sign in with
          your existing registered email ID and the new password.
        </p>
        <p className="mb-4 text-sm text-slate-600">
          New teachers who have not activated their account yet can use Teacher Activation.
        </p>
        <Link className="btn w-full text-center" href="/login">Back to sign in</Link>
        <p className="mt-3 text-center text-sm">
          New teacher? <Link className="text-maroon underline" href="/teacher-activate">Activate your account</Link>
        </p>
      </div>
    </div>
  );
}
