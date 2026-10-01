import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { PasswordPair, passwordsMatch } from '@/components/auth/PasswordPair';
import { Alert, Button, buttonStyles, toast } from '@/components/ui';
import { authClient } from '@/lib/auth';

// Legacy: reset links emailed before the code flow (see /forgot-password) land here. Better Auth redirects as /reset-password?token=… (or ?error=INVALID_TOKEN).
export const Route = createFileRoute('/reset-password')({
  validateSearch: (s: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof s.token === 'string' && { token: s.token }),
    ...(typeof s.error === 'string' && { error: s.error }),
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get('password'));
    setError(null);
    if (!passwordsMatch(f)) return setSubmitted(true);
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    setBusy(false);
    if (error) return setError(error.code === 'INVALID_TOKEN' ? 'This reset link has expired. Request a new one.' : error.message || 'Could not reset the password.');
    toast('Password updated. Sign in with your new password.', { tone: 'good' });
    await navigate({ to: '/login' });
  }

  if (!token || linkError)
    return (
      <AuthLayout
        title="Link expired"
        subtitle="Reset links work once and expire after an hour."
        footer={
          <Link to="/login" className={buttonStyles({ variant: 'link', className: 'hit' })}>
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <Alert tone="warn">This link has already been used, has expired, or was cut off when it was copied. Reset it with a code instead.</Alert>
          <Link to="/forgot-password" className={buttonStyles({ size: 'lg', className: 'w-full' })}>
            Request a new code
          </Link>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <PasswordPair label="New password" submitted={submitted} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
