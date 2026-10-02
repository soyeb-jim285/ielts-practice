import { Link, useRouterState } from '@tanstack/react-router';
import { Button, buttonStyles, Dialog } from '@/components/ui';
import { plural } from '@/lib/format';
import { isGuestTier, type Quota, type Skill } from '@/lib/community';
import { BalanceMeter } from './BalanceMeter';

/**
 * Shown before a test that is paid from the community balance, once per person per day. Honest and short: what is shared, what is asked,
 * what is left, and the way to unlimited. Closing it (Esc, X) means "not now".
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
      title="You're using the community balance"
      description="This test is paid from a shared balance that everyone uses. Please don't abuse it: no spamming tests and no automated use."
      footer={
        <>
          {guest ? (
            <Link to="/signup" search={{ redirect }} className={buttonStyles({ variant: 'outline' })}>
              Create an account
            </Link>
          ) : (
            <Link to="/settings" hash="api-keys" className={buttonStyles({ variant: 'outline' })}>
              Use my own key
            </Link>
          )}
          <Button onClick={onStart}>Start test</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {left != null && (
          <p>
            You have <strong className="font-semibold">{plural(left, `${skill} test`)}</strong> left {s.window === 'week' ? 'this week' : 'today'}.
          </p>
        )}
        <BalanceMeter />
        <p className="text-muted">{guest ? 'Create an account for 1 test a day.' : 'Want unlimited tests and the live examiner? Add your own API key in Settings.'}</p>
      </div>
    </Dialog>
  );
}
