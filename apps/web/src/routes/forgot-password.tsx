import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout, CheckEmail } from '@/components/layout/AuthLayout';
import { Alert, Button, buttonStyles, Input } from '@/components/ui';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPassword });

function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email')).trim();
    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${location.origin}/reset-password` });
    setBusy(false);
    if (error) return setError(error.message || 'Could not send the reset email. Try again.');
    setSentTo(email);
  }

  if (sentTo)
    return (
      <AuthLayout title="Check your email" subtitle="If an account exists for that address, a reset link is on its way.">
        <CheckEmail email={sentTo} />
      </AuthLayout>
    );

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your account email and we’ll send you a link."
      footer={
        <Link to="/login" className={buttonStyles({ variant: 'link', className: 'hit' })}>
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
