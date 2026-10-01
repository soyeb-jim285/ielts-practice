import { useEffect, useState } from 'react';
import { Button, toast } from '@/components/ui';
import { otpError, type AuthError } from '@/lib/auth';

const COOLDOWN_S = 30; // matches the server, which sends at most one email per address every 30 s

/** "Resend code" with a 30 s cooldown, starting now (the code was just sent). */
export function ResendCode({ send }: { send: () => Promise<{ error: AuthError | null }> }) {
  const [wait, setWait] = useState(COOLDOWN_S);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  async function resend() {
    setWait(COOLDOWN_S);
    const { error } = await send();
    toast(error ? otpError(error) : 'New code sent', { tone: error ? 'bad' : 'good' });
  }
  return (
    <Button type="button" variant="outline" disabled={wait > 0} onClick={resend}>
      {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
    </Button>
  );
}
