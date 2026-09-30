import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LiveProvider } from '@/components/settings/LiveProvider';
import { DEFAULT_MODELS, ModelPicker, TtsPicker } from '@/components/settings/ModelPicker';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { useUpdateSettings } from '@/components/settings/useUpdateSettings';
import { Button, Card, Collapsible, CollapsibleContent, CollapsibleTrigger, Dialog, Input, PageHeader, Switch } from '@/components/ui';
import { authClient, signOut } from '@/lib/auth';
import type { Settings } from '@/lib/api';
import { useMe } from '@/lib/query';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

/** One settings group: title + description in a left column from md, one card of rows on the right. */
function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid items-start gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <Card className="min-w-0 divide-y divide-line overflow-clip" padded={false}>
        {children}
      </Card>
    </section>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="p-5">{children}</div>;
/** Label left, control right (wraps under on phones). */
const InlineRow = ({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) => (
  <Row>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 max-w-[60ch] text-sm text-muted">{description}</p>}
      </div>
      {children}
    </div>
  </Row>
);

function SettingsPage() {
  const me = useMe().data!;
  const s = me.settings;
  const { mutate } = useUpdateSettings();
  const setModel = (key: keyof Settings['models']) => (v: string) => mutate({ models: { [key]: v } });

  return (
    <div className="pb-8">
      <PageHeader title="Settings" description="Changes save automatically." />
      <div className="space-y-8 md:space-y-10">
        <Section title="Goal" description="Scores at or above your target show green; up to one band below, amber; further below, red.">
          <Row>
            <TargetBandSlider hint="Most universities ask for 6.5–7.0 overall." />
          </Row>
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
          <LiveProvider value={s.liveProvider} available={me.realtimeAvailable} onChange={(v) => mutate({ liveProvider: v })} />
        </Section>

        <Section title="Appearance" description="Saved in this browser.">
          <InlineRow title="Theme" description="Light, dark, or follow your device.">
            <ThemeToggle />
          </InlineRow>
        </Section>

        <Section title="AI models" description="The models that score your work and play the examiner. The defaults suit most people.">
          <Collapsible>
            <CollapsibleTrigger className="group flex min-h-16 w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Customise models</span>
                <span className="mt-0.5 block truncate text-sm text-muted">Scoring: {s.models.analysis}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-line border-t border-line">
                <p className="max-w-[65ch] px-5 py-4 text-sm text-muted">Any OpenRouter model works. Costs are rough estimates for scoring one essay or spoken answer.</p>
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
    </div>
  );
}

function Account({ email }: { email: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

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
    <Section title="Account" description="Your sign-in and data.">
      <InlineRow title="Signed in as" description={<span className="block truncate">{email}</span>}>
        <Button variant="secondary" icon={<LogOut />} onClick={out}>
          Sign out
        </Button>
      </InlineRow>
      <InlineRow title="Delete account" description="Removes your recordings, essays, results and review cards. This can't be undone.">
        <Button variant="danger" icon={<Trash2 />} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </InlineRow>
      <Dialog
        open={open}
        onClose={close}
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
    </Section>
  );
}
