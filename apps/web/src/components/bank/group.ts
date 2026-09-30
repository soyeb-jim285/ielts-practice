const DAY = 864e5;
const startOfDay = (t: number | string | Date) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();

/** Recency bucket for grouping newest-first lists: Today, Yesterday, Past 7 days, Past 30 days, Older. */
export function dayBucket(date: string | number | Date, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Past 7 days' : days < 30 ? 'Past 30 days' : 'Older';
}

/** Splits an ordered list into consecutive runs that share a key. */
export function runs<T>(items: T[], key: (t: T) => string) {
  const out: { key: string; items: T[] }[] = [];
  for (const it of items) {
    const k = key(it);
    if (out.at(-1)?.key !== k) out.push({ key: k, items: [] });
    out.at(-1)!.items.push(it);
  }
  return out;
}
