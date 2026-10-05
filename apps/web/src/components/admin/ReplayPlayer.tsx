import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Alert, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatClock } from '@/lib/format';

// ponytail: typed by hand until `pnpm gen:api` brings AdminReplayItem into schema.d.ts.
export type ReplayItem = { id: string; userId: string | null; email: string | null; startedAt: string; lastAt: string; durationS: number; pages: { path: string; at: number }[]; bytes: number; chunks: number; userAgent: string | null };
type Ev = { type: number; timestamp: number; data?: { width?: number; height?: number } };
type PlayerHandle = { goto: (ms: number, play?: boolean) => void; $destroy?: () => void };

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
      player.current = new Player({ target, props: { events: data as never, width, height, autoPlay: false, showController: true, skipInactive: true } }) as unknown as PlayerHandle;
    });
    return () => {
      dead = true;
      player.current?.$destroy?.();
      player.current = undefined;
    };
  }, [data]);

  if (events.isError || meta.isError) return <Alert tone="bad">Couldn't load this recording.</Alert>;
  if (events.isPending || meta.isPending) return <Skeleton className="h-96 w-full" />;
  if (!data?.length) return <Alert tone="neutral">This recording has no events.</Alert>;

  const start = data[0]!.timestamp;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div className="min-w-0">
        <p className="type-caption type-num mb-2">Duration {formatClock(Math.round(meta.data.durationS))}</p>
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
