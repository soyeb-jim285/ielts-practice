import { CircleAlert, CircleCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, toast } from '@/components/ui';
import { authClient, otpError, type AuthError, type EmailStatus } from '@/lib/auth';

const POLLS = 10; // every 2 s for 20 s after a send, so a failure that lands late still shows up
const WHY = { rate_limited: 'the email service is busy', rejected: 'the address was refused', network: 'the email service could not be reached', unavailable: 'the email service is down' } as const;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What the sender screen says about the code email, from the server's status. Exported for tests. */
export function StatusLine({ s, now = Date.now() }: { s: EmailStatus | null; now?: number }) {
  if (!s || s.status === 'none') return <p role="status" className="type-small text-muted">Sending the code…</p>;
  if (s.status === 'failed')
    return (
      <p role="alert" className="type-small flex items-start gap-2 text-bad-text">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>We couldn’t send the email{s.error ? ` (${WHY[s.error]})` : ''}. Try again.</span>
      </p>
    );
  const to = s.maskedEmail ?? 'your address';
  if (s.alreadySent && s.sentAt) {
    const ago = Math.max(0, Math.round((now - new Date(s.sentAt).getTime()) / 1000));
    return (
      <p role="status" className="type-small flex items-start gap-2">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-good-text" aria-hidden />
        <span>Code already sent {ago} s ago to {to}; it is still valid. Check spam{s.resendAvailableIn > 0 ? `; you can resend in ${s.resendAvailableIn} s` : ''}.</span>
      </p>
    );
  }
  return (
    <p role="status" className="type-small flex items-start gap-2">
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-good-text" aria-hidden />
      <span>Code sent to {to}{s.sentAt ? ` at ${clock(s.sentAt)}` : ''}. Check your spam folder if it doesn’t show up.</span>
    </p>
  );
}

type Sent = { error: AuthError | null; statusToken?: string | null };

/** Delivery status + "Resend code" with a live countdown, under a code-entry form. `token` comes from the call that sent the first code (sign-up / send); null when that call itself failed. */
export function CodeDelivery({ token: first, send }: { token: string | null; send: () => Promise<Sent> }) {
  const [token, setToken] = useState(first);
  const [s, setS] = useState<EmailStatus | null>(null);
  const [wait, setWait] = useState(0);
  const [sendFailed, setSendFailed] = useState(first === null);
  const [, tick] = useState(0);

  const apply = useCallback((n: EmailStatus | null) => {
    setS(n);
    setWait(n?.resendAvailableIn ?? 0);
  }, []);

  useEffect(() => {
    if (!token) return;
    let n = 0;
    let stop = false;
    const poll = async () => {
      const r = await authClient.emailStatus(token);
      if (!stop) apply(r);
    };
    void poll();
    const t = setInterval(() => (++n >= POLLS ? clearInterval(t) : void poll()), 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token, apply]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => {
      setWait((w) => w - 1);
      tick((x) => x + 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function resend() {
    setSendFailed(false);
    const r = await send();
    if (r.error || !r.statusToken) {
      setSendFailed(true);
      return toast(r.error ? otpError(r.error) : 'Could not send the code. Try again.', { tone: 'bad' });
    }
    setS(null);
    setToken(r.statusToken);
  }

  return (
    <div className="space-y-3">
      {sendFailed ? <StatusLine s={{ status: 'failed', sentAt: null, maskedEmail: null, resendAvailableIn: 0, alreadySent: false, error: 'network' }} /> : <StatusLine s={s && wait !== s.resendAvailableIn ? { ...s, resendAvailableIn: wait } : s} />}
      <Button type="button" variant="outline" disabled={wait > 0} onClick={resend}>
        {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
      </Button>
    </div>
  );
}
