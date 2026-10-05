import { Button } from '@/components/ui';

/** Newer / Older with "page of pages". Renders nothing for a single page. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="Pages">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Newer
      </Button>
      <span className="type-caption type-num">
        {page} of {pages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Older
      </Button>
    </nav>
  );
}
