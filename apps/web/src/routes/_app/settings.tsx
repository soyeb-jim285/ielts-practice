import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ChevronDown, LogOut, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { DEFAULT_MODELS, ModelPicker, TtsPicker } from '@/components/settings/ModelPicker';
import { TargetBandSlider } from '@/components/settings/TargetBandSlider';
import { useUpdateSettings } from '@/components/settings/useUpdateSettings';
import { Button, Card, Dialog, Input, PageHeader, Switch } from '@/components/ui';
import { authClient, signOut } from '@/lib/auth';
import type { Settings } from '@/lib/api';
import { useMe } from '@/lib/query';

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage });

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 md:grid-cols-[13rem_1fr] md:gap-8">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <Card className="divide-y divide-line" padded={false}>
        {children}
      </Card>
    </section>
  );
}
const Row = ({ children }: { children: ReactNode }) => <div className="p-5">{children}</div>;

function SettingsPage() {
  const me = useMe().data!;
  const s = me.settings;
  const { mutate } = useUpdateSettings();
  const setModel = (key: keyof Settings['models']) => (v: string) => mutate({ models: { [key]: v } });

  return (
    <div className="pb-8">
      <PageHeader title="Settings" description="Changes save automatically." />
      <div className="space-y-10">
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
          <Row>
            <LiveProvider value={s.liveProvider} available={me.realtimeAvailable} onChange={(v) => mutate({ liveProvider: v })} />
          </Row>
        </Section>

        <Section title="Advanced" description="The AI models that score your work and play the examiner. The defaults suit most people.">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              AI models
              <ChevronDown className="size-4 text-muted transition-transform duration-150 group-open:rotate-180" aria-hidden />
            </summary>
            <div className="divide-y divide-line border-t border-line">
              <p className="px-5 py-3 text-sm text-muted">Any OpenRouter model works. Costs are rough estimates for scoring one essay or spoken answer.</p>
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
          </details>
        </Section>

        <Section title="Appearance" description="Saved in this browser.">
          <Row>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">Theme</span>
              <ThemeToggle />
            </div>
          </Row>
        </Section>

        <Account email={me.user.email} />
      </div>
    </div>
  );
}

function LiveProvider({ value, available, onChange }: { value: Settings['liveProvider']; available: boolean; onChange: (v: Settings['liveProvider']) => void }) {
  const options = [
    { value: 'turn' as const, label: 'Examiner waits for you to finish', description: 'The examiner asks a question, then listens until you pause.' },
    {
      value: 'openai-realtime' as const,
      label: 'Natural conversation',
      description: available ? 'Talk back and forth as in the real test. You can interrupt each other.' : 'Not available right now.',
      disabled: !available,
    },
  ];
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">Conversation mode</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={clsx(
              'flex gap-3 rounded-control border p-3.5 transition-colors duration-150 has-focus-visible:ring-2 has-focus-visible:ring-accent',
              o.disabled ? 'cursor-not-allowed border-line opacity-60' : 'cursor-pointer hover:border-line-strong',
              value === o.value && !o.disabled ? 'border-accent bg-accent-soft' : 'border-line',
            )}
          >
            <input type="radio" name="liveProvider" value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-0.5 size-4 accent-(--accent)" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="mt-0.5 block text-sm text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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
      <Row>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">Signed in as</p>
            <p className="truncate font-medium">{email}</p>
          </div>
          <Button variant="secondary" icon={<LogOut />} onClick={out}>
            Sign out
          </Button>
        </div>
      </Row>
      <Row>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Delete account</p>
            <p className="mt-0.5 text-sm text-muted">Removes your recordings, essays, results and review cards. This can't be undone.</p>
          </div>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      </Row>
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
