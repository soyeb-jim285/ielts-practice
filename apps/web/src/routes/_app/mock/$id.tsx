import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { MockResult } from '@/components/mock/MockResult';
import { SectionList } from '@/components/mock/SectionList';
import { SpeakingChoice } from '@/components/mock/SpeakingChoice';
import { Transition } from '@/components/mock/Transition';
import { useMock, useMockActions } from '@/components/mock/useMock';
import { Alert, Badge, Button, buttonStyles, Dialog, PageContainer, PageHeader, Skeleton } from '@/components/ui';

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
      <PageContainer>
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

  return (
    <PageContainer>
      <PageHeader
        title={open ? 'Full mock test' : 'Mock result'}
        back={<Link to="/mock" className={buttonStyles({ variant: 'link', className: '-ml-1' })}><ArrowLeft className="size-4" aria-hidden /> Mock tests</Link>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{mock.variant === 'academic' ? 'Academic' : 'General Training'}</Badge>
            {mock.ref && <Badge tone="info">{mock.ref}</Badge>}
            {mock.status === 'closed' && <Badge tone="warn">Finished without Speaking</Badge>}
          </span>
        }
      />
      <div className="space-y-8">
        {open && (next === 'speaking' ? <SpeakingChoice mockId={mock.id} onLive={() => a.chooseLive.mutate()} liveBusy={a.chooseLive.isPending} error={a.chooseLive.error?.message} /> : <Transition mock={mock} onStart={start} busy={a.startLr.isPending} error={lrErr} />)}
        {(!open || !next) && <MockResult mock={mock} target={target} />}
        <section aria-label="Your sections">
          <SectionList mock={mock} target={target} />
          {open && mock.sections.some((s) => s.state === 'marking') && <p className="type-caption mt-3" role="status">Marking runs in the background. This page updates by itself.</p>}
        </section>
        {open && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-5">
            {next === 'speaking' && <Button variant="ghost" onClick={() => setConfirm('close')}>Finish without Speaking</Button>}
            <Button variant="ghost" className="text-muted" onClick={() => setConfirm('abandon')}>Abandon this mock test</Button>
          </div>
        )}
      </div>
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
    </PageContainer>
  );
}

