import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthLayout, CheckEmail } from '@/components/layout/AuthLayout';
import { Alert, Button, Input, toast } from '@/components/ui';
import { authClient, redirectIfSignedIn } from '@/lib/auth';
import { queryClient } from '@/lib/query';

export const Route = createFileRoute('/signup')({ beforeLoad: redirectIfSignedIn, component: Signup });

function Signup() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const callbackURL = `${location.origin}/`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signUp.email({ name: String(f.get('name')).trim(), email, password: String(f.get('password')), callbackURL });
    setBusy(false);
    if (error) return setError(error.code === 'USER_ALREADY_EXISTS' || error.status === 422 ? 'An account with this email already exists. Try signing in.' : error.message || 'Could not create the account.');
    if (!data?.token) return setSentTo(email); // email verification required before first sign-in
    queryClient.removeQueries({ queryKey: ['me'] });
    router.history.push('/');
  }

  if (sentTo)
    return (
      <AuthLayout title="Check your email" subtitle="One step left: verify your address.">
        <CheckEmail
          email={sentTo}
          onResend={async () => {
            const { error } = await authClient.sendVerificationEmail({ email: sentTo, callbackURL });
            toast(error ? 'Could not send the email. Try again shortly.' : 'Sent again', { tone: error ? 'bad' : 'good' });
          }}
        />
      </AuthLayout>
    );

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Timed Speaking and Writing practice with honest band feedback."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="hit font-medium text-accent-text hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Name" name="name" autoComplete="name" required autoFocus />
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <Input label="Password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required hint="At least 8 characters." />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
