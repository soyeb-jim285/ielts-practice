import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatClock } from '@/lib/format';
import { mediaAt, mediaFix, mediaTimeline } from '@/lib/replay-media';

// ponytail: typed by hand until `pnpm gen:api` brings AdminReplayItem into schema.d.ts.
export type ReplayItem = { id: string; userId: string | null; email: string | null; startedAt: string; lastAt: string; durationS: number; pages: { path: string; at: number }[]; bytes: number; chunks: number; userAgent: string | null };
type Ev = { type: number; timestamp: number; data?: { width?: number; height?: number } };
type Replayer = {
  iframe: HTMLIFrameElement;
  config: { skipInactive: boolean };
  setConfig: (c: { skipInactive?: boolean }) => void;
  getCurrentTime: () => number;
  getMirror: () => { getId: (n: Node) => number };
  on: (event: string, fn: (p: unknown) => void) => void;
  service: { state: { matches: (s: string) => boolean } };
  speedService: { state: { matches: (s: string) => boolean; context: { timer: { speed: number } } } };
};
type PlayerHandle = { goto: (ms: number, play?: boolean) => void; getReplayer: () => Replayer; $destroy?: () => void };

/** Keeps every recorded <audio>/<video> in the replay at the place, speed and play state the events say (replay-media.ts), and holds off
 *  skip-inactive while one is playing: a student listening is not idle. Returns the stop function. */
function driveMedia(r: Replayer, events: Ev[], onSkip: (speed: number | null) => void) {
  const marks = mediaTimeline(events as never);
  if (!marks.size) return () => {};
  // ponytail: rrweb's MediaManager is private; muting its sync keeps it from fighting this loop (rrweb 2.1.x). Without it this still corrects every tick.
  const mm = (r as unknown as { mediaManager?: { syncTargetWithState?: unknown } }).mediaManager;
  if (mm) mm.syncTargetWithState = () => {};
  let wantSkip = r.config.skipInactive, listening = false;
  const setConfig = r.setConfig.bind(r);
  // the player re-applies its skip toggle (on seek, speed change): remember what the admin chose, keep the hold while media plays
  r.setConfig = (c) => {
    if (c.skipInactive !== undefined) wantSkip = c.skipInactive;
    setConfig(c.skipInactive !== undefined ? { ...c, skipInactive: wantSkip && !listening } : c);
  };
  r.on('skip-start', (p) => onSkip((p as { speed?: number }).speed ?? null));
  r.on('skip-end', () => onSkip(null));
  const tick = () => {
    const doc = r.iframe.contentDocument;
    if (!doc) return;
    const now = r.getCurrentTime(), playing = r.service.state.matches('playing'), speed = r.speedService.state.context.timer.speed;
    listening = [...marks.values()].some((m) => mediaAt(m, now)?.playing);
    for (const el of doc.querySelectorAll<HTMLMediaElement>('audio, video')) {
      const want = mediaAt(marks.get(r.getMirror().getId(el)), now);
      if (!want) continue;
      const fix = mediaFix(el, want, speed, playing);
      if (el.playbackRate !== fix.rate) el.playbackRate = fix.rate;
      el.muted = fix.muted;
      el.volume = fix.volume;
      if (fix.seekTo !== null && el.readyState > 0) el.currentTime = fix.seekTo;
      if (fix.play && el.paused) void el.play().catch(() => {});
      else if (!fix.play && !el.paused) el.pause();
    }
    r.config.skipInactive = wantSkip && !listening;
    if (listening && r.speedService.state.matches('skipping')) (r as unknown as { backToNormal?: () => void }).backToNormal?.();
  };
  const id = setInterval(tick, 250);
  ['start', 'pause', 'resume', 'finish', 'skip-start'].forEach((e) => r.on(e, () => queueMicrotask(tick)));
  return () => clearInterval(id);
}

export const replayQuery = (id: string) => ({ queryKey: ['admin', 'replay', id], queryFn: () => api.get<ReplayItem>(`/admin/replays/${id}`) });
export const dhakaTime = (iso: string | number) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Plays one recorded tab with rrweb-player, loaded (with its CSS) only when this mounts, plus a jump list of the pages visited. */
export function ReplayPlayer({ sessionId }: { sessionId: string }) {
  const meta = useQuery(replayQuery(sessionId));
  const events = useQuery({ queryKey: ['admin', 'replay', sessionId, 'events'], queryFn: () => api.get<{ events: Ev[] }>(`/admin/replays/${sessionId}/events`).then((r) => r.events), staleTime: Infinity });
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerHandle | undefined>(undefined);
  const data = events.data;
  const [skipping, setSkipping] = useState<number | null>(null);

  useEffect(() => {
    if (!data || data.length < 2 || !box.current) return;
    let dead = false;
    const target = box.current;
    void Promise.all([import('rrweb-player'), import('rrweb-player/dist/style.css')]).then(([{ default: Player }]) => {
      if (dead) return;
      const width = target.clientWidth;
      const view = data.find((e) => e.type === 4)?.data; // Meta: the recorded viewport
      const height = Math.min(640, Math.round((width * (view?.height ?? 600)) / (view?.width ?? 1000)));
      target.replaceChildren();
      const p = new Player({ target, props: { events: data as never, width, height, autoPlay: false, showController: true, skipInactive: true } }) as unknown as PlayerHandle;
      player.current = p;
      stopMedia = driveMedia(p.getReplayer(), data, setSkipping);
    });
    let stopMedia: (() => void) | undefined;
    return () => {
      dead = true;
      stopMedia?.();
      player.current?.$destroy?.();
      player.current = undefined;
    };
  }, [data]);

  if (events.isError || meta.isError) return <Alert tone="bad">Couldn't load this recording.</Alert>;
  if (events.isPending || meta.isPending)
    return (
      <div aria-busy>
        <p className="type-caption mb-2">{meta.data ? `Loading ${meta.data.chunks} pieces (${(meta.data.bytes / 1e6).toFixed(1)} MB). A long session takes a while.` : 'Loading the recording.'}</p>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (!data?.length) return <Alert tone="neutral">This recording has no events.</Alert>;

  const start = data[0]!.timestamp;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0">
        <p className="type-caption type-num mb-2" aria-live="polite">
          Duration {formatClock(Math.round(meta.data.durationS))}
          {skipping && <span className="ml-2 rounded-md bg-accent-soft px-2 py-0.5 font-medium text-accent-text">Skipping idle time at {skipping}x</span>}
        </p>
        <div ref={box} className="w-full overflow-hidden rounded-md border border-line" />
      </div>
      <section aria-label="Pages visited">
        <h2 className="type-caption mb-2 font-medium">Pages ({meta.data.pages.length})</h2>
        <ol className="max-h-96 divide-y divide-line overflow-auto border-y border-line">
          {meta.data.pages.map((p, i) => (
            <li key={i}>
              <button type="button" className="hover:bg-hover flex w-full items-baseline justify-between gap-3 px-1 py-2 text-left text-sm" onClick={() => player.current?.goto(Math.max(0, p.at - start))}>
                <span className="min-w-0 truncate">{p.path}</span>
                <span className="type-caption type-num shrink-0">{formatClock(Math.max(0, Math.round((p.at - start) / 1000)))}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
