import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Button, buttonStyles, toast } from '@/components/ui';
import { api } from '@/lib/api';

type Mode = 'full' | 'p1' | 'p2' | 'p3';

/** Link props that start a speaking session (a full test, one part, or a specific prompt). */
export const speakingSession = (mode: Mode, promptId?: string) =>
  ({ to: '/speaking/session', search: { mode, promptId } }) as const;

/** "Practice" button for a bank prompt. */
export function PracticeLink({ prompt }: { prompt: { id: string; skill: 'speaking' | 'writing'; part: number } }) {
  const cls = buttonStyles({ variant: 'secondary', size: 'sm' });
  const label = <><Play aria-hidden /> Practice</>;
  return prompt.skill === 'writing' ? (
    <Link to="/writing/task/$promptId" params={{ promptId: prompt.id }} className={cls}>
      {label}
    </Link>
  ) : (
    <Link {...speakingSession(`p${prompt.part}` as Mode, prompt.id)} className={cls}>
      {label}
    </Link>
  );
}

/** Opens the editor on a random Task (default 2) prompt, preferring ones not done yet. */
export function StartWritingButton({ task = 2, children, ...rest }: { task?: 1 | 2; children: ReactNode } & Omit<ComponentProps<typeof Button>, 'onClick' | 'loading'>) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const p = await api.get<{ id: string }>(`/prompts/random?skill=writing&part=${task}`);
      await navigate({ to: '/writing/task/$promptId', params: { promptId: p.id } });
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button {...rest} loading={busy} onClick={start}>
      {children}
    </Button>
  );
}
