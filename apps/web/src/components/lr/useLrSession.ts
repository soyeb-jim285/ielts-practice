import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';
import type { LrAttempt, LrResponses } from '@/lib/lr';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * Answers of an in-progress attempt: local state, debounced autosave (~1 s), flush on blur / tab hide / page hide, a keep-alive save of the clock
 * every 15 s, and submit. `elapsed` is read through a ref so the clock never re-renders this hook.
 */
export function useLrSession(attempt: LrAttempt) {
  const id = attempt.id;
  const [responses, setResponses] = useState<LrResponses>(attempt.responses);
  const [state, setState] = useState<SaveState>('saved');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const latest = useRef(responses);
  const elapsed = useRef(attempt.elapsedS);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busy = useRef(false);
  const done = useRef(false);

  const flush = useCallback(
    async (beacon = false) => {
      clearTimeout(timer.current);
      if (done.current || (!dirty.current && !beacon)) return;
      const body = JSON.stringify({ responses: latest.current, elapsedS: Math.floor(elapsed.current) });
      if (beacon) {
        // page is going away: a normal fetch may be cancelled
        void fetch(`/api/lr/attempts/${id}`, { method: 'PUT', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {});
        dirty.current = false;
        return;
      }
      if (busy.current) {
        timer.current = setTimeout(() => void flush(), 500);
        return;
      }
      busy.current = true;
      dirty.current = false;
      setState('saving');
      try {
        await api.put(`/lr/attempts/${id}`, JSON.parse(body));
        setState(dirty.current ? 'dirty' : 'saved');
      } catch {
        dirty.current = true;
        setState('error');
        timer.current = setTimeout(() => void flush(), 5000); // offline: keep trying
      } finally {
        busy.current = false;
      }
    },
    [id],
  );

  const change = useCallback(
    (next: LrResponses) => {
      latest.current = next;
      setResponses(next);
      dirty.current = true;
      setState('dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 1000);
    },
    [flush],
  );

  useEffect(() => {
    const hide = () => document.visibilityState === 'hidden' && void flush(true);
    const blur = () => void flush();
    const pagehide = () => void flush(true);
    const tick = setInterval(() => {
      dirty.current = true; // persist the clock too
      void flush();
    }, 15_000);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', pagehide);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', pagehide);
      void flush();
    };
  }, [flush]);

  const submit = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    clearTimeout(timer.current);
    setSubmitting(true);
    try {
      const res = await api.post<LrAttempt>(`/lr/attempts/${id}/submit`, { responses: latest.current, elapsedS: Math.floor(elapsed.current) });
      queryClient.setQueryData(['lr-attempt', id], res);
      void queryClient.invalidateQueries({ queryKey: ['lr-tests'] });
      void queryClient.invalidateQueries({ queryKey: ['lr-attempts'] });
      await navigate({ to: '/lr/result/$attemptId', params: { attemptId: id }, replace: true });
    } catch (e) {
      done.current = false;
      setSubmitting(false);
      throw e;
    }
  }, [id, navigate]);

  return { responses, change, state, elapsed, submit, submitting, flush };
}
