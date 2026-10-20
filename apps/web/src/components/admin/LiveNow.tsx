import type { LiveNow as LiveNowData } from '@server/admin/schemas';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { userLabel } from '@/components/admin/format';
import { Load, Section } from '@/components/admin/Load';
import { useAdmin } from '@/lib/admin';
import { formatClock } from '@/lib/format';

const PHASE: Record<string, string> = { intro: 'Introduction', p1: 'Part 1', 'p2-prep': 'Part 2, preparing', 'p2-talk': 'Part 2, talking', 'p2-follow': 'Part 2', p3: 'Part 3', closing: 'Closing' };
const device = (ua: string | null) => (ua ? (/iPhone|iPad/.exec(ua)?.[0] ?? (/Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other')) : '');
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : `${m} min ago`;
};

function Who({ u }: { u: { userId: string; email: string | null } }) {
  return (
    <Link to="/admin/users/$userId" params={{ userId: u.userId }} className="block truncate font-medium text-accent-text underline-offset-4 hover:underline">
      {userLabel({ id: u.userId, email: u.email })}
    </Link>
  );
}

function Column<T>({ title, items, empty, row }: { title: string; items: T[]; empty: string; row: (item: T) => ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="type-caption mb-1 font-medium">
        {title} <span className="type-num text-ink">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.slice(0, 8).map((it, i) => (
            <li key={i} className="py-2 text-sm">{row(it)}</li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

/** Who is on the site right now and what they are doing. Refreshes every 20 s. */
export function LiveNow() {
  const q = useAdmin<LiveNowData>('/live-now', {}, { refetchInterval: 20_000 });
  return (
    <Section title="Live now" aside="Updates every 20 s" className="mt-0">
      <Load q={q} lines={1}>
        {(d) => {
          const now = Date.parse(d.generatedAt);
          return (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Column title="Online" items={d.online} empty="Nobody in the last 5 minutes." row={(o) => (
                <><Who u={o} /><p className="type-caption truncate">{o.page ?? '-'} · {device(o.userAgent)} · {ago(o.lastAt, now)}</p></>
              )} />
              <Column title="Listening and Reading tests" items={d.exams} empty="No test under way." row={(e) => (
                <><Who u={e} /><p className="type-caption truncate"><span className="capitalize">{e.skill}</span> · {e.test} · {formatClock(e.elapsedS)} in</p></>
              )} />
              <Column title="Live examiner" items={d.live} empty="No live test." row={(l) => (
                <><Who u={l} /><p className="type-caption truncate">{PHASE[l.phase ?? ''] ?? 'Starting'} · started {ago(l.startedAt, now)}</p></>
              )} />
              <Column title="Speaking and Writing" items={d.attempts} empty="Nothing recording or being scored." row={(a) => (
                <><Who u={a} /><p className="type-caption truncate"><span className="capitalize">{a.skill}</span> {a.skill === 'writing' ? 'Task' : 'Part'} {a.part} · {a.status === 'analyzing' ? `being scored${a.tries > 1 ? `, try ${a.tries}` : ''}` : 'in progress'} · {a.prompt}</p></>
              )} />
            </div>
          );
        }}
      </Load>
    </Section>
  );
}
