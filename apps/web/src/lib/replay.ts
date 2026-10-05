import { queryClient } from './query';

/** Session recording (docs/admin/DESIGN.md "Replay: recorder"). rrweb is only ever imported dynamically. */
export const SID_KEY = 'ielts.replay.sid'; // contract: the feedback button reads it
const EXCLUDED = ['/login', '/signup', '/forgot-password', '/reset-password'];
const MAX_CHUNK = 900_000; // the server refuses 1 MB
const MAX_BUFFER = 2_000_000; // kept while there is no session yet
const MAX_TRIES = 5;
const FLUSH_MS = 10_000;

type Ev = { type: number; [k: string]: unknown };
type Page = { path: string; at: number };
type Chunk = { seq: number; events: Ev[]; pages: Page[]; tries: number };

export const isExcluded = (path: string) => EXCLUDED.some((p) => path.startsWith(p));

/** Takes events off the front while the JSON stays under `max`; always at least one event (rrweb snapshots can't be split). */
export function splitChunk(events: Ev[], max = MAX_CHUNK): [Ev[], Ev[]] {
  let size = 2;
  let n = 0;
  while (n < events.length && (n === 0 || size + JSON.stringify(events[n]).length + 1 <= max)) size += JSON.stringify(events[n++]).length + 1;
  return [events.slice(0, n), events.slice(n)];
}

/** Over `max` bytes: keeps the first Meta (4) and FullSnapshot (2), which the player needs, then only what still fits. */
export function capBuffer(events: Ev[], max = MAX_BUFFER): Ev[] {
  let size = 0;
  let head = 2;
  return events.filter((e) => {
    const n = JSON.stringify(e).length + 1;
    const keep = head > 0 && (e.type === 2 || e.type === 4) ? (head--, true) : size + n <= max;
    if (keep) size += n;
    return keep;
  });
}

const sessionId = () => {
  try {
    return sessionStorage.getItem(SID_KEY) ?? (sessionStorage.setItem(SID_KEY, crypto.randomUUID()), sessionStorage.getItem(SID_KEY)!);
  } catch {
    return crypto.randomUUID(); // storage blocked: one id for this page load
  }
};

type Router = { state: { location: { pathname: string } }; subscribe: (event: 'onResolved', fn: (e: { toLocation: { pathname: string } }) => void) => unknown };
let started = false;

export function startReplay(router: Router): void {
  if (started) return;
  started = true;
  void run(router);
}

async function run(router: Router) {
  const { record } = await import('rrweb');
  const url = `/api/replay/${sessionId()}/chunks`;
  let buffer: Ev[] = [];
  let pages: Page[] = [];
  let pending: Chunk | null = null;
  let nextSeq = 0;
  let busy = false;
  let noSession = false;
  let full = false;
  let stop: (() => void) | undefined;

  const take = (): Chunk | null => {
    if (pending) return pending;
    if (!buffer.length) return null;
    const [events, rest] = splitChunk(buffer);
    buffer = rest;
    return (pending = { seq: nextSeq++, events, pages: pages.splice(0, 20), tries: 0 });
  };

  // Sends chunks one at a time, in seq order.
  async function flush() {
    if (busy || full || noSession) return;
    busy = true;
    try {
      for (let c = take(); c; c = take()) {
        const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq: c.seq, events: c.events, pages: c.pages }) }).catch(() => null);
        if (res?.ok) pending = null;
        else if (res?.status === 401) {
          // No session yet: put the chunk back and wait for the me query to change.
          buffer = capBuffer([...c.events, ...buffer]);
          pages = [...c.pages, ...pages];
          nextSeq--;
          pending = null;
          noSession = true;
        } else if ((await res?.json().catch(() => null))?.code === 'replay_full') {
          full = true;
          buffer = [];
          stop?.();
        } else if (res?.status === 413 || res?.status === 400 || ++c.tries >= MAX_TRIES) pending = null; // unsendable: drop, seq moves on
        else return; // retry the same seq on the next tick
        if (noSession || full) return;
      }
    } finally {
      busy = false;
    }
  }

  // Page hide: beacons survive the unload. 64 KB limit, so a big chunk may be lost.
  const beacon = () => {
    if (full || noSession) return;
    for (let c = take(); c; c = take()) {
      const body = JSON.stringify({ seq: c.seq, events: c.events, pages: c.pages });
      pending = null;
      if (!navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) void fetch(url, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {});
    }
  };

  const sync = (path: string) => {
    if (isExcluded(path)) {
      if (stop) {
        stop();
        stop = undefined;
        void flush();
      }
    } else if (!stop && !full) {
      stop = record({
        emit: (e) => buffer.push(e as unknown as Ev),
        maskAllInputs: false,
        maskInputOptions: { password: true },
        blockSelector: '[data-replay-block]',
        recordCanvas: false,
        collectFonts: false,
        inlineStylesheet: true,
        sampling: { scroll: 150, input: 'last' },
        checkoutEveryNms: 5 * 60_000,
      });
    }
  };

  sync(router.state.location.pathname);
  if (!isExcluded(router.state.location.pathname)) pages.push({ path: router.state.location.pathname, at: Date.now() });
  router.subscribe('onResolved', (e) => {
    const path = e.toLocation.pathname;
    sync(path);
    if (!isExcluded(path)) pages.push({ path, at: Date.now() });
  });
  queryClient.getQueryCache().subscribe((e) => {
    if (noSession && e.query.queryKey[0] === 'me' && e.type === 'updated') {
      noSession = false;
      void flush();
    }
  });
  setInterval(() => {
    if (noSession) buffer = capBuffer(buffer);
    void flush();
  }, FLUSH_MS);
  addEventListener('pagehide', beacon);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && beacon());
}
