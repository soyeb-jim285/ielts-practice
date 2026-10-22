/** Where each recorded <audio>/<video> should be at any replay time, from the rrweb events alone.
 *  rrweb's own media replay loses the state on a seek (it applies events to a virtual DOM), can't play past the browser's 16x
 *  limit and drifts between interactions, so the admin player drives media itself from this (ReplayPlayer.tsx). */
type Ev = { type: number; timestamp: number; data?: any };
type SNode = { id?: number; tagName?: string; attributes?: Record<string, unknown>; childNodes?: SNode[] };
export type MediaMark = { at: number; playing: boolean; time: number; rate: number; volume: number; muted: boolean };

const FULL = 2, INCREMENTAL = 3, MUTATION = 0, MEDIA = 7;
const PLAY = 0, PAUSE = 1;
/** Browsers refuse playbackRate outside this range (and throw). */
export const MAX_RATE = 16, MIN_RATE = 0.0625;

/** Marks per mirror node id, in time order (`at` = ms from the first event, the replayer's clock). */
export function mediaTimeline(events: Ev[]): Map<number, MediaMark[]> {
  const out = new Map<number, MediaMark[]>();
  const t0 = events[0]?.timestamp ?? 0;
  const push = (id: number, at: number, m: Partial<MediaMark>) => {
    const list = out.get(id) ?? (out.set(id, []), out.get(id)!);
    const last = list.at(-1) ?? { at, playing: false, time: 0, rate: 1, volume: 1, muted: false };
    list.push({ ...last, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)), at });
  };
  // a snapshot (page load, a 5-minute checkout, a node added later) carries the element's state as rr_media* attributes
  const walk = (n: SNode | undefined, at: number) => {
    if (!n) return;
    if (n.id != null && (n.tagName === 'audio' || n.tagName === 'video')) {
      const a = n.attributes ?? {};
      const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : undefined);
      push(n.id, at, { playing: a.rr_mediaState === 'played', time: num('rr_mediaCurrentTime') ?? 0, rate: num('rr_mediaPlaybackRate'), volume: num('rr_mediaVolume'), muted: typeof a.rr_mediaMuted === 'boolean' ? a.rr_mediaMuted : undefined });
    }
    n.childNodes?.forEach((c) => walk(c, at));
  };
  for (const e of events) {
    const at = e.timestamp - t0;
    if (e.type === FULL) walk(e.data?.node, at);
    else if (e.type === INCREMENTAL && e.data?.source === MUTATION) for (const add of e.data.adds ?? []) walk(add.node, at);
    else if (e.type === INCREMENTAL && e.data?.source === MEDIA && e.data.id != null) {
      const d = e.data;
      push(d.id, at, { ...(d.type === PLAY ? { playing: true } : d.type === PAUSE ? { playing: false } : {}), time: d.currentTime, rate: d.playbackRate, volume: d.volume, muted: d.muted });
    }
  }
  return out;
}

/** The element's state at replay time `at` (ms), or null before it has any. A playing element moves on from its last mark at its own rate. */
export function mediaAt(marks: MediaMark[] | undefined, at: number): MediaMark | null {
  if (!marks?.length || at < marks[0]!.at) return null;
  let i = marks.length - 1;
  while (marks[i]!.at > at) i--;
  const m = marks[i]!;
  return m.playing ? { ...m, time: m.time + ((at - m.at) / 1000) * m.rate } : m;
}

/** What to do to a real element so it matches `want` at player `speed`: rate capped to what browsers allow (muted beyond it), a seek only when it drifted. */
export function mediaFix(el: { currentTime: number; paused: boolean; duration: number }, want: MediaMark, speed: number, playerPlaying: boolean) {
  const rate = want.rate * speed;
  const time = Number.isFinite(el.duration) ? Math.min(want.time, el.duration) : want.time;
  return {
    play: want.playing && playerPlaying && time < (Number.isFinite(el.duration) ? el.duration : Infinity),
    rate: Math.min(MAX_RATE, Math.max(MIN_RATE, rate)),
    muted: want.muted || rate > MAX_RATE,
    volume: want.volume,
    // tolerance grows with speed: at 8x the clock moves 2 s between 250 ms checks
    seekTo: Math.abs(el.currentTime - time) > Math.max(0.35, 0.3 * speed) ? time : null,
  };
}
