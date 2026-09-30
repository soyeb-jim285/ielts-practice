import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';

/** Infinite-scroll sentinel: auto-loads when scrolled into view, with a button fallback (keyboard, no IO). */
export function LoadMore({ hasMore, loading, onLoad }: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onLoad(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoad]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      <Button variant="outline" loading={loading} onClick={onLoad}>
        Load more
      </Button>
    </div>
  );
}

/** Next page number for `{ page, pageSize, total }` responses, or undefined at the end. */
export const nextPage = (p: { page: number; pageSize: number; total: number }) => (p.page * p.pageSize < p.total ? p.page + 1 : undefined);
