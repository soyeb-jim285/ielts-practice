import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Ellipsis, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast } from '@/components/ui';
import { call, client } from '@/lib/api';
import { cn } from '@/lib/utils';

type Kind = 'attempt' | 'lr';
type Listy = { items?: { id: string }[]; pages?: { items: { id: string }[]; total?: number }[]; total?: number };

// Every cached list that can show an attempt (History pages, hub "recent", guest "Your recent tests").
const LISTS = [['attempts'], ['lr-attempts'], ['guest-recent'], ['writing-recent']];
// Derived views that must forget it too (the server recomputes them from the remaining attempts).
const DERIVED = [['progress'], ['lr-progress'], ['lr-spelling'], ['mistakes'], ['cards']];

function without(d: unknown, id: string): unknown {
  const l = d as Listy | undefined;
  if (l?.pages) return { ...l, pages: l.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== id), total: p.total == null ? p.total : Math.max(0, p.total - (p.items.some((x) => x.id === id) ? 1 : 0)) })) };
  if (l?.items) return { ...l, items: l.items.filter((x) => x.id !== id) };
  return d;
}

/** Hard-deletes one attempt (DELETE /api/attempts/{id} or /api/lr/attempts/{id}). Lists drop it at once and come back if the server refuses. */
function useRemove(kind: Kind, id: string, onRemoved?: () => void) {
  const qc: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: () => (kind === 'lr' ? call(client.DELETE('/api/lr/attempts/{id}', { params: { path: { id } } })) : call(client.DELETE('/api/attempts/{id}', { params: { path: { id } } }))),
    onMutate: async () => {
      await Promise.all(LISTS.map((queryKey) => qc.cancelQueries({ queryKey })));
      const before = LISTS.flatMap((queryKey) => qc.getQueriesData({ queryKey }));
      for (const queryKey of LISTS) qc.setQueriesData({ queryKey }, (d: unknown) => without(d, id));
      return { before };
    },
    onError: (e, _v, ctx) => {
      for (const [k, d] of ctx?.before ?? []) qc.setQueryData(k, d);
      toast(e instanceof Error && e.message ? `Couldn't remove it: ${e.message}` : "Couldn't remove it. Try again.", { tone: 'bad' });
    },
    onSuccess: () => {
      onRemoved?.();
      qc.removeQueries({ queryKey: [kind === 'lr' ? 'lr-attempt' : 'attempt', id] });
      toast('Removed from your history', { tone: 'good' });
    },
    onSettled: () => {
      for (const queryKey of [...LISTS, ...DERIVED]) void qc.invalidateQueries({ queryKey });
    },
  });
}

/**
 * "Remove from history" with its confirm dialog. `row`: a trailing trash button for list rows (sits beside the row link, 44 px target).
 * `menu`: a "More actions" button with the item in a menu, for result-page headers. `onRemoved` runs after the server says yes (result pages leave).
 */
export function RemoveAttempt({ kind, id, title, variant = 'row', onRemoved, className }: { kind: Kind; id: string; title: string; variant?: 'row' | 'menu'; onRemoved?: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const remove = useRemove(kind, id, onRemoved);
  const confirm = () => {
    setOpen(false);
    remove.mutate();
  };
  return (
    <>
      {variant === 'row' ? (
        <Button variant="ghost" size="icon" aria-label={`Remove ${title} from history`} title="Remove from history" onClick={() => setOpen(true)} className={cn('shrink-0 text-muted hover:text-bad-text', className)}>
          <Trash2 aria-hidden />
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions" className={className}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setOpen(true)}>
              <Trash2 aria-hidden /> Remove from history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove from history?"
        description="This permanently deletes the result, recording and analysis. It can't be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm}>
              Remove
            </Button>
          </>
        }
      >
        <p className="type-caption line-clamp-2">{title}</p>
      </Dialog>
    </>
  );
}
