import { Link, useRouterState } from '@tanstack/react-router';
import { Button, buttonStyles, Dialog } from '@/components/ui';
import { plural } from '@/lib/format';
import { isGuestTier, UNIT, windowWord, type Quota, type Skill } from '@/lib/community';

/**
 * Shown before a limited test (guest or free account), once per person per day. Honest and short: what is asked and what is left.
 * Closing it (Esc, X) means "not now".
 */
export function FairUseDialog({ open, quota, skill, onStart, onClose }: { open: boolean; quota: Quota; skill: Skill; onStart: () => void; onClose: () => void }) {
  const redirect = useRouterState({ select: (s) => s.location.href });
  const guest = isGuestTier(quota.tier);
  const s = quota[skill];
  const left = s.remaining;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Before you start"
      description="Free tests are for your own practice. Please use them fairly: no spamming tests and no automated use."
      footer={
        <>
          {guest && (
            <Link to="/signup" search={{ redirect }} className={buttonStyles({ variant: 'outline' })}>
              Create an account
            </Link>
          )}
          <Button onClick={onStart}>Start test</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {left != null && (
          <p>
            You have <strong className="font-semibold">{plural(left, UNIT[skill])}</strong> left {windowWord(s)}.
          </p>
        )}
        {guest && <p className="text-muted">Create a free account for more tests.</p>}
      </div>
    </Dialog>
  );
}
