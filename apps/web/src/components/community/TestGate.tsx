import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExamShell } from '@/components/layout/ExamShell';
import { Alert, Button, buttonStyles, Skeleton } from '@/components/ui';
import { acknowledgeFairUse, blockerFromQuota, blockerOf, fairUseAcknowledged, quotaQuery, type Blocker, type Quota, type Skill } from '@/lib/community';
import { ensureSession } from '@/lib/auth';
import { isAccount, useMe } from '@/lib/query';
import { BlockedPanel } from './BlockedPanel';
import { FairUseDialog } from './FairUseDialog';

type State = { kind: 'checking' } | { kind: 'error' } | { kind: 'blocked'; blocker: Blocker } | { kind: 'ack'; quota: Quota } | { kind: 'go' };

const HUB = { speaking: { to: '/speaking', label: 'Speaking' }, writing: { to: '/writing', label: 'Writing' } } as const;

/**
 * Wraps a test screen. Before anything is recorded or typed it asks /api/quota what this person may start, then:
 *   blocked          -> one panel with the reason and the way out
 *   community tier   -> the fair-use dialog (once a day)
 *   otherwise        -> makes sure there is a session (a guest session on the first test) and shows the test.
 * The quota is only reserved later, when the attempt is submitted.
 */
export function TestGate({ skill, title, children }: { skill: Skill; title: string; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe().data;
  const [state, setState] = useState<State>({ kind: 'checking' });
  const hub = HUB[skill];
  const userId = isAccount(me) ? me.user.id : null;

  const proceed = useCallback(async () => {
    try {
      await ensureSession();
      setState({ kind: 'go' });
    } catch (e) {
      setState({ kind: 'blocked', blocker: blockerOf(e) ?? { code: 'too_many_requests' } });
    }
  }, []);

  const check = useCallback(async () => {
    setState({ kind: 'checking' });
    let quota: Quota;
    try {
      quota = await qc.fetchQuery({ ...quotaQuery, staleTime: 0 });
    } catch {
      return setState({ kind: 'error' });
    }
    const blocker = blockerFromQuota(quota, skill);
    if (blocker) return setState({ kind: 'blocked', blocker });
    if (quota.tier !== 'own-key' && !fairUseAcknowledged(userId)) return setState({ kind: 'ack', quota });
    await proceed();
  }, [qc, skill, userId, proceed]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; one check per visit
    started.current = true;
    void check();
  }, [check]);

  if (state.kind === 'go') return <>{children}</>;

  const back = (
    <Link to={hub.to} className={buttonStyles({ variant: 'ghost' })}>
      <ArrowLeft aria-hidden /> Back to {hub.label.toLowerCase()}
    </Link>
  );
  return (
    <ExamShell
      title={title}
      exit={
        <Link to={hub.to} aria-label="Exit" className={buttonStyles({ variant: 'ghost', size: 'sm', className: '-ml-1 text-muted hover:text-ink' })}>
          <X aria-hidden />
          <span className="hidden sm:inline">Exit</span>
        </Link>
      }
    >
      {state.kind === 'blocked' ? (
        <BlockedPanel blocker={state.blocker} onRetry={() => void check()} back={back} />
      ) : state.kind === 'error' ? (
        <Alert tone="bad" title="Couldn't check your tests" action={<Button size="sm" onClick={() => void check()}>Try again</Button>}>
          Check your connection and try again. Nothing has been used.
        </Alert>
      ) : (
        <div className="space-y-4" aria-busy aria-label="Getting your test ready">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      )}
      {state.kind === 'ack' && (
        <FairUseDialog
          open
          quota={state.quota}
          skill={skill}
          onClose={() => void navigate({ to: hub.to })}
          onStart={() => {
            acknowledgeFairUse(userId);
            setState({ kind: 'checking' });
            void proceed();
          }}
        />
      )}
    </ExamShell>
  );
}
