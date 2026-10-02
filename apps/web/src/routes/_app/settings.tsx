import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AccountGate } from '@/components/community/AccountGate';
import { ApiKeys } from '@/components/settings/ApiKeys';
import { LiveProvider } from '@/components/settings/LiveProvider';
import { DEFAULT_MODELS, ModelPicker, TtsPicker, useModels } from '@/components/settings/ModelPicker';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { useUpdateSettings } from '@/components/settings/useUpdateSettings';
import { Alert, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, Input, PageContainer, PageHeader, Switch } from '@/components/ui';
import { authClient, signOut } from '@/lib/auth';
import type { Settings } from '@/lib/api';
import { useAccount, useMe } from '@/lib/query';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/settings')({ component: SettingsRoute });

/** Guests have no settings or keys: they get the sign-up gate, not an error. */
function SettingsRoute() {
  return useAccount() ? <SettingsPage /> : <AccountGate what="settings" />;
}

/**
 * One settings group: a left column with the serif heading and what it does, a right column with plain rows between hairlines (no card).
 * Stacks on phones. Rows use the page grid, so every section lines up.
 */
function Section({ title, description, children, className, id }: { title: string; description: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={`s-${title}`} className={cn('grid scroll-mt-6 gap-x-12 gap-y-4 border-t border-line pt-8 md:grid-cols-[14rem_minmax(0,1fr)]', className)}>
      <div>
        <h2 id={`s-${title}`} className="type-heading">
          {title}
        </h2>
        <p className="type-caption mt-1.5 max-w-[34ch]">{description}</p>
      </div>
      <div className="min-w-0 max-w-[40rem] divide-y divide-line [&>*:first-child]:pt-0">{children}</div>
    </section>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="py-5 first:pt-0 last:pb-0">{children}</div>;
/** Label left, control right (wraps under on phones). */
const InlineRow = ({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) => (
  <Row>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="type-caption mt-0.5 max-w-[60ch]">{description}</p>}
      </div>
      {children}
    </div>
  </Row>
);

function SettingsPage() {
  const me = useMe().data!;
  const community = me.tier !== 'own-key'; // custom models only run on the user's own OpenRouter key
  const s = me.settings;
  const { mutate } = useUpdateSettings();
  const setModel = (key: keyof Settings['models']) => (v: string) => mutate({ models: { [key]: v } });
  // Human name of the scoring model for the collapsed summary (same cached query as the picker), falling back to the id's last segment.
  const { data: textModels } = useModels('text');
  const scoringName = textModels?.models.find((m) => m.id === s.models.analysis)?.name ?? s.models.analysis.split('/').pop();

  return (
    <PageContainer className="pb-8">
      <PageHeader compact title="Settings" description="Changes save automatically." />
      <div className="space-y-10">
        <Section title="Goal" description="Scores at or above your target show green; up to one band below, amber; further below, red.">
          <Row>
            <TargetBandSlider hint="Most universities ask for 6.5-7.0 overall." />
          </Row>
        </Section>

        <Section id="api-keys" title="Your API keys" description="Practise without limits, or use the live examiner, with your own keys.">
          <ApiKeys />
        </Section>

        <Section title="Writing" description="How the timed essay editor behaves.">
          <Row>
            <Switch label="Submit when time runs out" description="Off: the timer keeps counting as overtime and the result is flagged." checked={s.writingAutoSubmit} onChange={(v) => mutate({ writingAutoSubmit: v })} />
          </Row>
          <Row>
            <Switch label="Block pasting" description="Matches the real test, where you type every word." checked={s.blockPaste} onChange={(v) => mutate({ blockPaste: v })} />
          </Row>
        </Section>

        <Section title="Live examiner" description="How the live speaking test talks to you.">
          <LiveProvider
            value={s.liveProvider}
            available={{ turn: me.liveProviders.includes('turn'), 'gpt-live': me.gptLiveAvailable, 'gemini-live': me.geminiLiveAvailable }}
            onChange={(v) => mutate({ liveProvider: v })}
          />
        </Section>

        <Section title="Appearance" description="Saved in this browser.">
          <InlineRow title="Theme" description="Light, dark, or follow your device.">
            <ThemeToggle />
          </InlineRow>
        </Section>

        <Section title="AI models" description="The models that score your work and play the examiner. The defaults suit most people.">
          <Collapsible>
            <CollapsibleTrigger className="group -my-1 flex min-h-14 w-full items-center gap-3 rounded-md py-2 text-left hover:text-accent-text">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Customise models</span>
                <span className="type-caption mt-0.5 block truncate">Scoring: {scoringName}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-line border-t border-line">
                {community && (
                  <div className="py-4">
                    <Alert tone="info">Your own OpenRouter key is needed to use other models. Until then, tests paid from the community balance always use the default models.</Alert>
                  </div>
                )}
                <p className="type-caption max-w-[65ch] py-4">Any OpenRouter model works. Costs are rough estimates for scoring one essay or spoken answer.</p>
                <Row>
                  <ModelPicker label="Scoring and feedback" capability="text" value={s.models.analysis} defaultValue={DEFAULT_MODELS.analysis} onChange={setModel('analysis')} />
                </Row>
                <Row>
                  <ModelPicker label="Examiner" capability="text" value={s.models.examiner} defaultValue={DEFAULT_MODELS.examiner} onChange={setModel('examiner')} hint="Asks the questions when the examiner waits for you to finish." />
                </Row>
                <Row>
                  <ModelPicker label="Speech to text" capability="stt" value={s.models.stt} defaultValue={DEFAULT_MODELS.stt} onChange={setModel('stt')} hint="Needs word timestamps for fluency metrics." />
                </Row>
                <Row>
                  <TtsPicker value={s.models.tts} voice={s.models.ttsVoice} onChange={(models) => mutate({ models })} />
                </Row>
                <Row>
                  <div className="space-y-4">
                    <Switch
                      label="Audio pronunciation check"
                      description="Sends your recording to an audio model for prosody and pronunciation notes. Slower and costs more."
                      checked={s.audioPronEnabled}
                      onChange={(v) => mutate({ audioPronEnabled: v })}
                    />
                    {s.audioPronEnabled && (
                      <ModelPicker label="Pronunciation model" capability="audio-in" value={s.models.audioPron} defaultValue={DEFAULT_MODELS.audioPron} onChange={setModel('audioPron')} hint="Must accept audio input." />
                    )}
                  </div>
                </Row>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Section>

        <Account email={me.user.email} />
      </div>
    </PageContainer>
  );
}

function Account({ email }: { email: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const out = async () => {
    await signOut();
    await navigate({ to: '/login' });
  };
  const del = async () => {
    setBusy(true);
    setError(undefined);
    const { error: e } = await authClient.deleteUser({ password });
    setBusy(false);
    if (e) return setError(e.message ?? 'Could not delete the account');
    await out();
  };
  const close = () => {
    setOpen(false);
    setPassword('');
    setError(undefined);
  };

  return (
    <>
      <Section title="Account" description="Your sign-in.">
        <InlineRow title="Signed in as" description={<span className="block truncate">{email}</span>}>
          <Button variant="outline" icon={<LogOut />} onClick={out}>
            Sign out
          </Button>
        </InlineRow>
      </Section>
      <Section title="Danger zone" description="Permanent actions.">
        <InlineRow title="Delete account" description="Removes your recordings, essays, results and review cards. This can't be undone.">
          <Button ref={deleteButton} variant="ghost" className="text-bad-text hover:bg-bad-soft hover:text-bad-text" icon={<Trash2 />} onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </InlineRow>
      </Section>
      <Dialog
        open={open}
        onClose={close}
        returnFocusRef={deleteButton}
        title="Delete your account?"
        description="Everything you've recorded and written will be permanently deleted."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Keep account
            </Button>
            <Button variant="danger" loading={busy} disabled={!password} onClick={del}>
              Delete forever
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void del();
          }}
        >
          <Input label="Confirm with your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        </form>
      </Dialog>
    </>
  );
}
