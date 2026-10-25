import { Link, useRouterState } from '@tanstack/react-router';
import { Clock, Gauge, PauseCircle, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, buttonStyles, IconTile } from '@/components/ui';
import { blockerCopy, isGuestTier, type Blocker } from '@/lib/community';

const ICON = { quota_exceeded: Clock, community_balance_exhausted: PauseCircle, community_busy: Users, too_many_requests: Gauge } as const;

/** The ways out, per reason (docs/community.md, Client UX 3). The first is the primary action. */
function Actions({ blocker, onRetry, size, back }: { blocker: Blocker; onRetry?: () => void; size?: 'sm'; back?: ReactNode }) {
  const redirect = useRouterState({ select: (s) => s.location.href });
  const guest = isGuestTier(blocker.tier);
  const create = (label: string, primary: boolean) => (
    <Link to="/signup" search={{ redirect }} className={buttonStyles({ variant: primary ? 'primary' : 'outline', size })}>
      {label}
    </Link>
  );
  const retry = onRetry && (
    <Button size={size} onClick={onRetry}>
      Try again
    </Button>
  );
  switch (blocker.code) {
    case 'quota_exceeded':
      return (
        <>
          {guest && create('Create an account for more tests', true)}
          {back}
        </>
      );
    default:
      return (
        <>
          {retry}
          {back}
        </>
      );
  }
}

/** Full-page explanation for a test that cannot start: the reason, the reset time, and the way out. Shown before anything is recorded or typed. */
export function BlockedPanel({ blocker, onRetry, back }: { blocker: Blocker; onRetry?: () => void; /** A secondary link back to where the person came from. */ back?: ReactNode }) {
  const { title, body } = blockerCopy(blocker);
  const Icon = ICON[blocker.code];
  return (
    <div className="space-y-5">
      <IconTile>
        <Icon />
      </IconTile>
      <div className="space-y-2">
        <h1 className="type-title-sm text-balance">{title}</h1>
        <p className="type-lede max-w-[52ch]">{body}</p>
      </div>
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap [&>*]:max-sm:w-full">
        <Actions blocker={blocker} onRetry={onRetry} back={back} />
      </div>
    </div>
  );
}

/** The same explanation as a notice inside a page that must stay put: a submit refused mid-test keeps the draft on screen. */
export function BlockedAlert({ blocker, keeps, className }: { blocker: Blocker; /** What is still safe, e.g. "Your essay is saved on this device." */ keeps?: string; className?: string }) {
  const { title, body } = blockerCopy(blocker);
  return (
    <Alert tone="warn" title={title} className={className} action={<div className="flex flex-wrap gap-2"><Actions blocker={blocker} size="sm" /></div>}>
      {body} {keeps}
    </Alert>
  );
}
