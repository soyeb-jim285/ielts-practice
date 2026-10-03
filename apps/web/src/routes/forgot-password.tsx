import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { PasswordPair, passwordsMatch } from '@/components/auth/PasswordPair';
import { CodeDelivery } from '@/components/auth/CodeDelivery';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert, Button, buttonStyles, Input, OtpInput, toast } from '@/components/ui';
import { authClient, otpError } from '@/lib/auth';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPassword });

const backToSignIn = (
  <Link to="/login" className={buttonStyles({ variant: 'link', className: 'hit' })}>
    Back to sign in
  </Link>
);

/** Two steps on one page: the address, then the emailed 6-digit code with the new password. The response never says whether the address has an account. */
function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const to = String(new FormData(e.currentTarget).get('email')).trim();
    setBusy(true);
    setError(null);
    const { error, statusToken } = await authClient.emailOtp.send({ email: to, type: 'forget-password' });
    setBusy(false);
    if (error) return setError(otpError(error));
    setToken(statusToken ?? null);
    setEmail(to);
  }

  async function reset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (code.length < 6) return setCodeError('Enter all 6 digits.');
    if (!passwordsMatch(f)) return setSubmitted(true);
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.resetPassword({ email: email!, otp: code, password: String(f.get('password')) });
    setBusy(false);
    if (error) return error.code === 'INVALID_OTP' || error.code === 'OTP_EXPIRED' || error.code === 'TOO_MANY_ATTEMPTS' ? setCodeError(otpError(error)) : setError(otpError(error));
    toast('Password updated. Sign in with your new password.', { tone: 'good' });
    await navigate({ to: '/login' });
  }

  if (email)
    return (
      <AuthLayout title="Enter your code" subtitle={`If an account exists for ${email}, we sent it a 6-digit code. It expires in 10 minutes.`} footer={backToSignIn}>
        <form onSubmit={reset} className="space-y-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setCodeError(null);
            }}
            error={codeError}
            autoFocus
          />
          <PasswordPair label="New password" submitted={submitted} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Update password
          </Button>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <CodeDelivery token={token} send={() => authClient.emailOtp.send({ email, type: 'forget-password' })} />
            <button type="button" onClick={() => setEmail(null)} className={buttonStyles({ variant: 'link', className: 'hit' })}>
              Use a different email
            </button>
          </div>
        </form>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your account email and we’ll send you a 6-digit code." footer={backToSignIn}>
      <form onSubmit={sendCode} className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Send code
        </Button>
      </form>
    </AuthLayout>
  );
}
