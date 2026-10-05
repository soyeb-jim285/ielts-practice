import { AudioLines, Clock, ListOrdered, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { QuotaNote } from '@/components/community/QuotaNote';
import { Alert, Button, buttonStyles, Card } from '@/components/ui';
import { useQuota } from '@/lib/community';
import { cn } from '@/lib/utils';

function Option({ icon, title, body, meta, children, note, disabled }: { icon: ReactNode; title: string; body: string; meta: string; children: ReactNode; note?: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-4 rounded-lg border border-line bg-surface p-5', disabled && 'bg-surface-2')}>
      <div>
        <p className="type-caption flex items-center gap-2">
          <span aria-hidden className="[&_svg]:size-4">
            {icon}
          </span>
          {meta}
        </p>
        <h3 className="type-subheading mt-2 text-base">{title}</h3>
        <p className="type-lede mt-1 text-sm">{body}</p>
      </div>
      <div className="mt-auto space-y-2">
        {children}
        {note}
      </div>
    </div>
  );
}

/** The last step: how to do Speaking. Recorded and live are the existing speaking runners; "later" leaves the mock open. */
export function SpeakingChoice({ mockId, onLive, liveBusy, error }: { mockId: string; onLive: () => void; liveBusy: boolean; error?: string }) {
  const quota = useQuota().data;
  const live = (quota?.liveProviders.length ?? 0) > 0;
  return (
    <Card tone="hero" className="space-y-5 sm:p-7">
      <div>
        <p className="type-caption font-medium text-accent-text">Last section</p>
        <h2 className="type-title-sm mt-2 text-balance">Writing finished. Choose how to do Speaking.</h2>
        <p className="type-lede mt-2 max-w-[56ch]">Speaking has no countdown, so you can take it now or later this week. Your overall band appears once it is marked.</p>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <Option icon={<ListOrdered />} meta="11 to 14 min, recorded" title="Recorded test" body="The examiner reads the questions. You record each answer at your own pace." note={<QuotaNote skill="speaking" />}>
          <Link to="/speaking/session" search={{ mode: 'full', mock: mockId }} className={buttonStyles({ className: 'max-sm:w-full' })}>
            Start recorded test
          </Link>
        </Option>
        <Option
          icon={<AudioLines />}
          meta="11 to 14 min, spoken"
          title="Live examiner"
          body="An AI examiner asks the questions aloud and follows up on what you say."
          disabled={!live}
          note={
            live ? undefined : (
              <p className="type-caption flex items-center gap-1.5">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Needs your own OpenAI or Gemini key.{' '}
                  <Link to="/settings" hash="api-keys" className="font-medium text-accent-text underline underline-offset-4">
                    Add your own key
                  </Link>
                </span>
              </p>
            )
          }
        >
          <Button onClick={onLive} loading={liveBusy} disabled={!live} className="max-sm:w-full">
            Start live examiner
          </Button>
        </Option>
        <Option icon={<Clock />} meta="Within 7 days" title="Do it later" body="Your mock stays open. Come back from the dashboard when you are ready.">
          <Link to="/" className={buttonStyles({ variant: 'outline', className: 'max-sm:w-full' })}>
            Back to dashboard
          </Link>
        </Option>
      </div>
    </Card>
  );
}
