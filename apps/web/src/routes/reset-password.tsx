import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, buttonStyles, Input, toast } from '@/components/ui';
import { authClient } from '@/lib/auth';

// Better Auth redirects here as /reset-password?token=… (or ?error=INVALID_TOKEN).
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get('password'));
    if (newPassword !== f.get('confirm')) return setError('The two passwords don’t match.');
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    setBusy(false);
    if (error) return setError(error.code === 'INVALID_TOKEN' ? 'This reset link has expired. Request a new one.' : error.message || 'Could not reset the password.');
    toast('Password updated. Sign in with your new password.', { tone: 'good' });
    await navigate({ to: '/login' });
  }

  if (!token || linkError)
    return (
      <AuthLayout title="Link expired" subtitle="Reset links work once and expire after an hour.">
        <Link to="/forgot-password" className={buttonStyles({ size: 'lg', className: 'w-full' })}>
          Request a new link
        </Link>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required autoFocus hint="At least 8 characters." />
        <Input label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
