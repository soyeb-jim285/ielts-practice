import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { cleanAudio, loadAudio, saveAudioLocal, type AudioState } from '@/lib/audioPos';
import type { LrAttempt, LrResponses } from '@/lib/lr';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const roundStats = (s: LrStats): LrStats => ({ ...s, partS: Object.fromEntries(Object.entries(s.partS).map(([k, v]) => [k, Math.round(v)])), ...(s.audio && { audio: cleanAudio(s.audio) }) });

/**
 * Answers of an in-progress attempt: local state, debounced autosave (~1 s), flush on blur / tab hide / page hide, a keep-alive save of the clock
 * every 15 s, and submit. `elapsed` is read through a ref so the clock never re-renders this hook.
 */
export type LrStats = { partS: Record<string, number>; changes: Record<string, number>; late: number[]; audio?: AudioState };

export function useLrSession(attempt: LrAttempt, lateFrom: { current: number }) {
  const id = attempt.id;
  const [responses, setResponses] = useState<LrResponses>(attempt.responses);
  const [state, setState] = useState<SaveState>('saved');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const latest = useRef(responses);
  const elapsed = useRef(attempt.elapsedS);
  // pacing: seconds per part (the runner ticks it), answer changes per question, questions answered in the last 5 minutes
  const stats = useRef<LrStats>({ ...(attempt.stats ?? { partS: {}, changes: {}, late: [] }), late: [...(attempt.stats?.late ?? [])] });
  if (!stats.current.audio) stats.current.audio = loadAudio(id, attempt.stats?.audio);
  const focusVal = useRef<Record<string, string>>({});
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busy = useRef(false);
  const done = useRef(false);

  const flush = useCallback(
    async (beacon = false) => {
      clearTimeout(timer.current);
      if (done.current || (!dirty.current && !beacon)) return;
      const body = JSON.stringify({ responses: latest.current, elapsedS: Math.floor(elapsed.current), stats: roundStats(stats.current) });
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
      const prev = latest.current;
      const field = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text' ? document.activeElement.dataset.q : undefined;
      for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
        if ((prev[k] ?? '') === (next[k] ?? '')) continue;
        // typing in a text gap counts once per visit (noteBlur); choosing / switching an option counts each time
        if (prev[k] && field !== k) stats.current.changes[k] = (stats.current.changes[k] ?? 0) + 1;
        if (next[k] && elapsed.current >= lateFrom.current && !stats.current.late.includes(+k)) stats.current.late.push(+k);
      }
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

  // practice audio position: `set` is hot (timeupdate, memory only); `save` persists locally and queues a server save now
  const audio = useMemo(
    () => ({
      start: (part: number) => stats.current.audio?.pos[part] ?? 0,
      get rate() {
        return stats.current.audio?.rate;
      },
      set: (part: number, pos: number, rate: number) => {
        stats.current.audio = { pos: { ...stats.current.audio?.pos, [part]: pos }, rate };
      },
      save: () => {
        if (!stats.current.audio || done.current) return;
        saveAudioLocal(id, stats.current.audio);
        dirty.current = true;
        void flush();
      },
    }),
    [id, flush],
  );

  const noteFocus = useCallback((n: number) => {
    focusVal.current[n] = latest.current[String(n)] ?? '';
  }, []);
  const noteBlur = useCallback((n: number) => {
    const before = focusVal.current[n];
    if (before && (latest.current[String(n)] ?? '') !== before) stats.current.changes[n] = (stats.current.changes[n] ?? 0) + 1;
    delete focusVal.current[n];
  }, []);

  const submit = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    clearTimeout(timer.current);
    setSubmitting(true);
    try {
      const res = await api.post<LrAttempt>(`/lr/attempts/${id}/submit`, { responses: latest.current, elapsedS: Math.floor(elapsed.current), stats: roundStats(stats.current) });
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

  return { responses, change, state, elapsed, submit, submitting, flush, stats, audio, noteFocus, noteBlur };
}
