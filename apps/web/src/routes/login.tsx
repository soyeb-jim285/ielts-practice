import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, Input, toast } from '@/components/ui';
import { authClient, redirectIfSignedIn, safeRedirect } from '@/lib/auth';
import { queryClient } from '@/lib/query';

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === 'string' ? { redirect: s.redirect } : {}),
  beforeLoad: redirectIfSignedIn,
  component: Login,
});

function Login() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; unverified?: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password: String(f.get('password')) });
    setBusy(false);
    if (error) {
      if (error.code === 'EMAIL_NOT_VERIFIED') return setError({ message: 'Please verify your email first. Check your inbox for the link.', unverified: email });
      return setError({ message: error.status === 401 ? 'That email and password don’t match.' : error.message || 'Could not sign in. Try again.' });
    }
    queryClient.removeQueries({ queryKey: ['me'] });
    router.history.push(safeRedirect(redirect));
  }

  async function resend(email: string) {
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: `${location.origin}/` });
    toast(error ? 'Could not send the email. Try again shortly.' : `Verification link sent to ${email}`, { tone: error ? 'bad' : 'good' });
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue your practice."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="hit font-medium text-accent-text hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <Alert
            tone="bad"
            action={
              error.unverified && (
                <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => resend(error.unverified!)}>
                  Resend verification email
                </button>
              )
            }
          >
            {error.message}
          </Alert>
        )}
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
        <div>
          <Input label="Password" name="password" type="password" autoComplete="current-password" required />
          <Link to="/forgot-password" className="hit mt-2 inline-block text-sm text-muted hover:text-ink hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
