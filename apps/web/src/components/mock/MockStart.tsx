import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Clock } from 'lucide-react';
import { useState } from 'react';
import { BlockedAlert } from '@/components/community/BlockedPanel';
import { QuotaNote } from '@/components/community/QuotaNote';
import { Alert, Button, buttonStyles, Card, Dialog, Segmented, Select, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { blockerFromQuota, blockerOf, useQuota } from '@/lib/community';
import { lsGet, lsSet } from '@/lib/lr';
import { mockOptionsQuery, SKILL_LABEL, type Mock } from '@/lib/mock';
import { cn } from '@/lib/utils';
import { useCurrentMock, useMockActions } from './useMock';

const RULES = [
  'Order: Listening, Reading, Writing, then Speaking.',
  'Times: Listening about 30 minutes plus a 2-minute check, Reading 60, Writing 60 for both tasks, Speaking 11 to 14.',
  'No pausing inside a timed section, as in the real test. The clock runs only inside a section.',
  'If you leave, you resume with the time already used kept.',
  'Speaking can wait: the mock stays open for 7 days.',
];

type Variant = Mock['variant'];
const VARIANT_KEY = 'mock:variant';

/** Resume card for the open mock; starting a new one asks first because it discards the old one. */
function Resume({ mock }: { mock: Mock }) {
  return (
    <Card tone="hero" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div>
        <h2 className="type-title-sm">Continue your mock test</h2>
        <p className="type-lede mt-1">{mock.next ? `${SKILL_LABEL[mock.next]} next.` : 'Open.'} Started {new Date(mock.startedAt).toLocaleDateString()}.</p>
      </div>
      <Link to="/mock/$id" params={{ id: mock.id }} className={buttonStyles({ className: 'shrink-0 max-sm:w-full' })}>
        Continue <ArrowRight aria-hidden />
      </Link>
    </Card>
  );
}

export function MockStart() {
  const open = useCurrentMock().data;
  const { create } = useMockActions();
  const quota = useQuota().data;
  const [variant, setVariant] = useState<Variant>(() => (lsGet<string>(VARIANT_KEY, 'academic') === 'general' ? 'general' : 'academic'));
  const [source, setSource] = useState<'own' | 'cambridge'>('own');
  const [pick, setPick] = useState<string | null>(null); // null = the default (lowest not started)
  const [confirm, setConfirm] = useState(false);
  const opts = useQuery(mockOptionsQuery(variant));
  const cambridge = opts.data?.cambridge ?? [];
  const useCambridge = source === 'cambridge' && cambridge.length > 0;
  const ref = useCambridge ? (pick && cambridge.some((c) => c.ref === pick) ? pick : (cambridge.find((c) => !c.started) ?? cambridge[0])!.ref) : undefined;
  const blocker = quota ? (blockerFromQuota(quota, 'writing') ?? blockerFromQuota(quota, 'speaking')) : null;
  const noSet = !!opts.data && !opts.data.own && cambridge.length === 0;

  const go = (replace: boolean) => create.mutate({ variant, source: useCambridge ? 'cambridge' : 'generated', ref, replace });
  const err = create.error;
  const startBlocker = err ? blockerOf(err) : null;

  return (
    <div className="space-y-8">
      {open && <Resume mock={open} />}
      <section aria-label="Set up" className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div>
            <p className="type-subheading mb-2">Test type</p>
            <Segmented
              label="Test type"
              className="w-full sm:w-72"
              value={variant}
              onChange={(v) => {
                setVariant(v);
                setPick(null);
                lsSet(VARIANT_KEY, v);
              }}
              options={[{ value: 'academic', label: 'Academic' }, { value: 'general', label: 'General Training' }]}
            />
          </div>
          {opts.isPending ? (
            <Skeleton className="h-9 w-72" />
          ) : (
            cambridge.length > 0 && (
              <div className="space-y-3">
                <p className="type-subheading">Questions</p>
                <Segmented
                  label="Question source"
                  className="w-full sm:w-72"
                  value={source}
                  onChange={setSource}
                  options={[{ value: 'own', label: 'Our own tests' }, { value: 'cambridge', label: 'Cambridge complete test' }]}
                />
                {source === 'cambridge' && (
                  <div className="flex items-end gap-2">
                    <Select className="sm:w-72" label="Complete test" value={ref} onChange={(e) => setPick(e.target.value)}>
                      {cambridge.map((c) => (
                        <option key={c.ref} value={c.ref}>
                          {c.bookTest}{c.started ? ' (started before)' : ''}
                        </option>
                      ))}
                    </Select>
                    <Button variant="outline" onClick={() => setPick(cambridge[Math.floor(Math.random() * cambridge.length)]!.ref)}>
                      Surprise me
                    </Button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
        <Card className="space-y-3" aria-labelledby="rules-h">
          <h2 id="rules-h" className="type-subheading flex items-center gap-2">
            <Clock className="size-4 text-muted" aria-hidden /> How it works
          </h2>
          <ul className="space-y-2 text-sm">
            {RULES.map((r) => (
              <li key={r} className="flex gap-2.5">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted" />
                {r}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {(blocker || startBlocker) && <BlockedAlert blocker={(blocker ?? startBlocker)!} keeps="Nothing has been started." />}
      {noSet && <Alert tone="warn" title="No complete test is available yet">There is no full set of Listening, Reading, Writing and Speaking for this test type. Try the other type.</Alert>}
      {err && !startBlocker && !(err instanceof ApiError && err.code === 'mock_open') && <Alert tone="bad" title="Could not start the mock test">{err.message}</Alert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" icon={<ArrowRight />} loading={create.isPending} disabled={!!blocker || noSet || opts.isPending} onClick={() => (open ? setConfirm(true) : go(false))} className="max-sm:w-full">
          {open ? 'Start a new mock test' : 'Start mock test'}
        </Button>
        <div className={cn('flex flex-col sm:flex-row sm:gap-5')}>
          <span className="type-caption">Writing: <QuotaNote skill="writing" className="inline" /></span>
          <span className="type-caption">Speaking: <QuotaNote skill="speaking" className="inline" /></span>
        </div>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Replace your open mock test?"
        description="Your open mock test is discarded. Its marked sections stay in your history as normal practice."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              loading={create.isPending}
              onClick={() => {
                setConfirm(false);
                go(true);
              }}
            >
              Discard and start new
            </Button>
          </>
        }
      />
    </div>
  );
}
