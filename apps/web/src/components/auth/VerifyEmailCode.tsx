import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, OtpInput } from '@/components/ui';
import { authClient, otpError, refreshSession } from '@/lib/auth';
import { CodeDelivery } from './CodeDelivery';

/** "Enter the code we emailed you" step for sign-up and for signing in with an unverified address. A correct code verifies the email and signs the user in. */
export function VerifyEmailCode({ email, token, onVerified }: { email: string; token: string | null; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length < 6) return setError('Enter all 6 digits.');
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp: code });
    setBusy(false);
    if (error) return setError(otpError(error));
    refreshSession();
    onVerified();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <MailCheck className="size-6 text-accent-text" aria-hidden />
      <p className="type-body">
        Enter the 6-digit code for <span className="font-medium">{email}</span>. It expires in 10 minutes.
      </p>
      <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} error={error} autoFocus />
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Verify email
      </Button>
      <CodeDelivery token={token} send={() => authClient.emailOtp.send({ email, type: 'email-verification' })} />
    </form>
  );
}
