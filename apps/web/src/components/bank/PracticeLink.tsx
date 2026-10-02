import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Button, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { ensureSession } from '@/lib/auth';

type Mode = 'full' | 'p1' | 'p2' | 'p3';

/** Link props that start a speaking session (a full test, one part, or a specific prompt). */
export const speakingSession = (mode: Mode, promptId?: string) =>
  ({ to: '/speaking/session', search: { mode, promptId } }) as const;

/** Link that starts practising a bank prompt (the writing editor, or a speaking session on that part). */
export function PromptLink({ prompt, className, children }: { prompt: { id: string; skill: 'speaking' | 'writing'; part: number }; className?: string; children: ReactNode }) {
  return prompt.skill === 'writing' ? (
    <Link to="/writing/task/$promptId" params={{ promptId: prompt.id }} search={{}} className={className}>
      {children}
    </Link>
  ) : (
    <Link {...speakingSession(`p${prompt.part}` as Mode, prompt.id)} className={className}>
      {children}
    </Link>
  );
}

/** Starts a writing task on a random prompt (default Task 2), preferring ones not done yet. `start` navigates; `busy` is true while it fetches. */
export function useStartWriting(task: 1 | 2 = 2) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await ensureSession(); // picking a test prompt needs a session; a guest gets theirs when they press Start
      const p = await call(client.GET('/api/prompts/random', { params: { query: { skill: 'writing', part: task } } }));
      await navigate({ to: '/writing/task/$promptId', params: { promptId: p.id } });
    } catch (e) {
      toast((e as Error).message, { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}

/** Button that starts a random writing task. */
export function StartWritingButton({ task = 2, children, ...rest }: { task?: 1 | 2; children: ReactNode } & Omit<ComponentProps<typeof Button>, 'onClick' | 'loading'>) {
  const { start, busy } = useStartWriting(task);
  return (
    <Button {...rest} loading={busy} onClick={start}>
      {children}
    </Button>
  );
}
