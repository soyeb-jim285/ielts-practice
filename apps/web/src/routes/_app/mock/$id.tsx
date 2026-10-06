import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { MockResult } from '@/components/mock/MockResult';
import { resultLink, SectionList } from '@/components/mock/SectionList';
import { SpeakingChoice } from '@/components/mock/SpeakingChoice';
import { Transition } from '@/components/mock/Transition';
import { useMock, useMockActions } from '@/components/mock/useMock';
import { ResultScaffold, Section, StatusLine } from '@/components/result';
import { Alert, Button, buttonStyles, Dialog, PageContainer, PageHeader, Skeleton } from '@/components/ui';

import { formatDate } from '@/lib/format';
import { useAccount, useMe } from '@/lib/query';

export const Route = createFileRoute('/_app/mock/$id')({ component: MockHub });

/** One page for the whole run: the transition between sections, the Speaking choice, and (once nothing is left to take) the result. */
function MockHub() {
  const { id } = Route.useParams();
  const account = useAccount();
  const navigate = useNavigate();
  const target = useMe().data?.settings.targetBand ?? 7;
  const { data: mock, error, isPending } = useMock(id);
  const a = useMockActions(id);
  const [confirm, setConfirm] = useState<'close' | 'abandon' | null>(null);

  if (!account) return <PageContainer><Alert tone="warn" title="Sign in to see your mock test" /></PageContainer>;
  if (isPending)
    return (
      <PageContainer aria-busy="true">
        <h1 className="sr-only">Mock test, loading</h1>
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  if (error || !mock)
    return (
      <PageContainer>
        <PageHeader title="Mock test not found" />
        <Alert tone="bad" title="This mock test is not available" action={<Link to="/mock" className={buttonStyles({ size: 'sm', variant: 'outline' })}>Start a new one</Link>}>
          It may have been discarded.
        </Alert>
      </PageContainer>
    );

  const open = mock.status === 'in_progress';
  const next = mock.next;
  const start = () => {
    if (next === 'listening' || next === 'reading') a.startLr.mutate(next);
    else if (next === 'writing') void navigate({ to: '/writing/full', search: { mock: mock.id } });
  };
  const lrErr = a.startLr.error?.message;

  const bands = mock.sections.filter((s) => s.band != null && s.attemptId);
  const weakSec = !open && bands.length > 1 ? bands.reduce((m, s) => (s.band! < m.band! ? s : m)) : null;
  const marking = open && mock.sections.some((s) => s.state === 'marking');
  return (
    <>
      <ResultScaffold
        back={{ to: '/mock', label: 'Mock tests' }}
        title={open ? 'Full mock test' : 'Mock result'}
        meta={<StatusLine items={[mock.variant === 'academic' ? 'Academic' : 'General Training', mock.ref, `started ${formatDate(mock.startedAt)}`]} />}
        hero={
          open && next === 'speaking' ? (
            <SpeakingChoice mockId={mock.id} onLive={() => a.chooseLive.mutate()} liveBusy={a.chooseLive.isPending} error={a.chooseLive.error?.message} />
          ) : open && next ? (
            <Transition mock={mock} onStart={start} busy={a.startLr.isPending} error={lrErr} />
          ) : (
            <MockResult mock={mock} target={target} />
          )
        }
      >
        <Section title="Your sections" caption={mock.overall != null ? 'Overall is the mean of your four section bands, to the nearest half band.' : undefined}>
          <SectionList mock={mock} target={target} />
          {weakSec && (
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link {...resultLink(weakSec)} className={buttonStyles({})}>Review {`${weakSec.skill[0]!.toUpperCase()}${weakSec.skill.slice(1)}`}, your weakest section</Link>
              <Link to="/mock" className={buttonStyles({ variant: 'outline' })}>Take another mock</Link>
            </div>
          )}
          {marking && <p className="type-caption" role="status">Marking runs in the background. This page updates by itself.</p>}
        </Section>
        {open && (
          <div className="-ml-3 flex flex-wrap gap-x-2 gap-y-1 border-t border-line pt-4">
            {next === 'speaking' && <Button variant="ghost" onClick={() => setConfirm('close')}>Finish without Speaking</Button>}
            <Button variant="ghost" className="text-muted" onClick={() => setConfirm('abandon')}>Abandon this mock test</Button>
          </div>
        )}
      </ResultScaffold>
      <Dialog
        open={confirm === 'close'}
        onClose={() => setConfirm(null)}
        title="Finish without Speaking?"
        description="The mock closes with Speaking skipped and no overall band. Your other sections stay in your history."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Keep going</Button><Button loading={a.close.isPending} onClick={() => a.close.mutate(undefined, { onSuccess: () => setConfirm(null) })}>Finish</Button></>}
      />
      <Dialog
        open={confirm === 'abandon'}
        onClose={() => setConfirm(null)}
        title="Abandon this mock test?"
        description="The mock is removed. Sections you already took stay in your history as normal practice."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button><Button variant="destructive" loading={a.abandon.isPending} onClick={() => a.abandon.mutate()}>Abandon</Button></>}
      />
    </>
  );
}

