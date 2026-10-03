import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { VerifyEmailCode } from '@/components/auth/VerifyEmailCode';
import { Alert, Button, buttonStyles, Input } from '@/components/ui';
import { authClient, redirectIfSignedIn, refreshSession, safeRedirect } from '@/lib/auth';

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === 'string' ? { redirect: s.redirect } : {}),
  beforeLoad: redirectIfSignedIn,
  component: Login,
});

function Login() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<string | null>(null); // address that still needs its code
  const [token, setToken] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password: String(f.get('password')) });
    setBusy(false);
    if (error) {
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        setToken((await authClient.emailOtp.send({ email, type: 'email-verification' })).statusToken ?? null);
        return setVerify(email);
      }
      return setError(error.status === 401 ? 'That email and password don’t match.' : error.message || 'Could not sign in. Try again.');
    }
    done();
  }

  function done() {
    refreshSession();
    router.history.push(safeRedirect(redirect));
  }

  if (verify)
    return (
      <AuthLayout title="Verify your email" subtitle="One step left before you can sign in.">
        <VerifyEmailCode email={verify} token={token} onVerified={done} />
      </AuthLayout>
    );

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={redirect ? 'Sign in to pick up where you left off.' : 'Sign in to continue your practice.'}
      footer={
        <>
          New here?{' '}
          <Link to="/signup" search={{ redirect }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <div>
          <Input label="Password" name="password" type="password" autoComplete="current-password" required />
          <div className="mt-3 flex justify-end">
            <Link to="/forgot-password" className={buttonStyles({ variant: 'link', className: 'hit' })}>
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
