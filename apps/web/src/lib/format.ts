/** 65 → "1:05", 3605 → "1:00:05". Negative values render with a leading "-" (overtime). */
export function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}` : `${sign}${m}:${ss}`;
}

/** 95_000 ms → "1m 35s", 42_000 → "42s", 3_900_000 → "1h 5m". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m${s % 60 ? ` ${s % 60}s` : ''}`;
}

/** IELTS bands: always one decimal ("6.0", "6.5"); null/undefined → "–". */
export const formatBand = (b: number | null | undefined) => (b == null ? '–' : b.toFixed(1));

/** [6, 7] → "6–7"; [6.5, 6.5] → "6.5". */
export const formatRange = ([lo, hi]: readonly [number, number]) => (lo === hi ? formatBand(lo) : `${lo}–${hi}`);

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago". */
export function formatRelative(date: Date | string | number, now = Date.now()): string {
  const diff = (new Date(date).getTime() - now) / 1000;
  for (const [unit, secs] of UNITS) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return 'just now';
}

/** "30 Sep 2026" (adds time with `withTime`). */
export const formatDate = (date: Date | string | number, withTime = false) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime && { hour: '2-digit', minute: '2-digit' }) }).format(new Date(date));

/** plural(1, 'word') → "1 word", plural(3, 'mistake') → "3 mistakes", plural(2, 'person', 'people'). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export const formatPercent = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
