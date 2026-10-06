import { useLocation } from '@tanstack/react-router';
import { MessageSquareWarning } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Textarea, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const MAX = 2000;
const EVENT = 'ielts:feedback';
/** Open the report dialog from any entry point (sidebar row, More sheet, exam bar). `returnTo` gets focus back on close when the opener unmounts. */
export const openFeedback = (returnTo?: HTMLElement | null) => window.dispatchEvent(new CustomEvent(EVENT, { detail: returnTo }));
const sid = () => {
  try {
    return sessionStorage.getItem('ielts.replay.sid') ?? undefined; // set by ReplayRecorder
  } catch {
    return undefined;
  }
};

/** "Report a problem" message dialog, mounted once at the root and opened by openFeedback(); sends the current page and replay session id. */
export function FeedbackDialog() {
  const { pathname, searchStr } = useLocation();
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      returnFocus.current = (e as CustomEvent<HTMLElement | null | undefined>).detail ?? null;
      setOpen(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/feedback', { message: message.trim(), page: (pathname + searchStr).slice(0, 300), replaySessionId: sid() });
      toast('Thanks, we got it.', { tone: 'good' });
      setOpen(false);
      setMessage('');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'You have sent a few already. Try again in a while.' : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={returnFocus}
        title="Report a problem"
        description="Tell us what went wrong. We also get the page you are on."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!message.trim()} onClick={send}>
              Send
            </Button>
          </>
        }
      >
        <Textarea label="What happened?" rows={5} maxLength={MAX} value={message} onChange={(e) => setMessage(e.target.value)} error={error} hint={`${message.length}/${MAX}`} />
      </Dialog>
  );
}
