import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { PasswordPair, passwordsMatch } from '@/components/auth/PasswordPair';
import { VerifyEmailCode } from '@/components/auth/VerifyEmailCode';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, buttonStyles, Input } from '@/components/ui';
import { authClient, redirectIfSignedIn, safeRedirect } from '@/lib/auth';
import { queryClient } from '@/lib/query';

export const Route = createFileRoute('/signup')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === 'string' ? { redirect: s.redirect } : {}),
  beforeLoad: redirectIfSignedIn,
  component: Signup,
});

function Signup() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const done = () => {
    queryClient.removeQueries({ queryKey: ['me'] });
    router.history.push(safeRedirect(redirect));
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!passwordsMatch(f)) return setSubmitted(true);
    const email = String(f.get('email')).trim();
    setBusy(true);
    setError(null);
    setExists(false);
    const { data, error } = await authClient.signUp.email({ name: String(f.get('name')).trim(), email, password: String(f.get('password')), callbackURL: `${location.origin}/` });
    setBusy(false);
    if (error) {
      if (error.code === 'USER_ALREADY_EXISTS' || error.status === 422) return setExists(true);
      return setError(error.message || 'Could not create the account.');
    }
    if (!data?.token) return setSentTo(email); // the server emailed a code: the address must be verified before first sign-in
    done();
  }

  if (sentTo)
    return (
      <AuthLayout title="Check your email" subtitle="One step left: verify your address.">
        <VerifyEmailCode email={sentTo} onVerified={done} />
      </AuthLayout>
    );

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Timed Speaking and Writing practice with honest band feedback."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" search={{ redirect }} className={buttonStyles({ variant: 'link', className: 'hit' })}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Name" name="name" autoComplete="name" required />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          onChange={() => exists && setExists(false)}
          error={
            exists && (
              <>
                An account with this email already exists.{' '}
                <Link to="/login" search={{ redirect }} className="font-medium underline underline-offset-2">
                  Sign in instead
                </Link>
              </>
            )
          }
        />
        <PasswordPair submitted={submitted} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
