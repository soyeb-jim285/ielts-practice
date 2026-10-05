import { useLocation, useMatches } from '@tanstack/react-router';
import { MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, Textarea, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const MAX = 2000;
const HIDDEN = /^\/(login|signup|forgot-password|reset-password)(\/|$)/;
const sid = () => {
  try {
    return sessionStorage.getItem('ielts.replay.sid') ?? undefined; // set by ReplayRecorder
  } catch {
    return undefined;
  }
};

/** "Report a problem": a ghost button (not on auth or exam routes) opening a message dialog; sends the current page and replay session id. */
export function FeedbackButton() {
  const { pathname, searchStr } = useLocation();
  const exam = useMatches({ select: (ms) => ms.some((m) => m.staticData.exam) });
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (exam || HIDDEN.test(pathname)) return null;

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
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<MessageSquareWarning />}
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 z-30 text-muted md:bottom-4"
      >
        Report a problem
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
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
    </>
  );
}
