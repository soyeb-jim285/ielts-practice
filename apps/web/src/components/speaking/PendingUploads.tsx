import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { deletePending, listPending, uploadPending, type Pending } from '@/hooks/pendingRecordings';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';

const KEY = ['pending-recordings'];
export const usePending = () => useQuery({ queryKey: KEY, queryFn: listPending, staleTime: 0 });

/** Upload a kept recording and open its result; Delete drops the local copy and the half-created attempt. */
function useActions(p: Pending) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['attempts'] })]);
  const upload = useMutation({
    mutationFn: () => uploadPending(p),
    onSuccess: async (id) => {
      await done();
      await navigate({ to: '/speaking/result/$attemptId', params: { attemptId: id }, search: p.sessionId ? { session: p.sessionId } : {} });
    },
    onError: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const discard = useMutation({
    mutationFn: async () => {
      if (p.attemptId) await api.del(`/attempts/${p.attemptId}`).catch(() => {});
      await deletePending(p.key);
    },
    onSuccess: done,
  });
  return { upload, discard };
}

function Row({ p }: { p: Pending }) {
  const { upload, discard } = useActions(p);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{p.label}</p>
        <p className="type-caption">Recorded {formatRelative(p.createdAt)}</p>
        {upload.error && <p className="text-xs text-bad-text">{upload.error.message}</p>}
      </div>
      <div className="flex gap-2">
        <Button size="sm" icon={<RotateCcw />} loading={upload.isPending} onClick={() => upload.mutate()}>
          Upload now
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={upload.isPending} loading={discard.isPending} onClick={() => discard.mutate()}>
          Delete
        </Button>
      </div>
    </li>
  );
}

/** Recordings that never finished uploading (kept on this device). Hidden when there are none. */
export function PendingUploads() {
  const { data } = usePending();
  if (!data?.length) return null;
  return (
    <section aria-labelledby="pending-h" className="space-y-3">
      <Alert tone="warn" title={<span id="pending-h">{data.length === 1 ? 'A recording was not uploaded' : `${data.length} recordings were not uploaded`}</span>}>
        They are still saved on this device. Upload them to get your band, or delete them.
      </Alert>
      <Card padded={false} className="overflow-hidden">
        <ul className="divide-y divide-line">
          {data.map((p) => (
            <Row key={p.key} p={p} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Result-page action for an attempt stuck in "Not submitted": resume the kept recording if this device has it, else record again; always allow deleting. */
export function NotSubmittedActions({ attemptId, onDeleted, recordAgain }: { attemptId: string; onDeleted: () => void; recordAgain: ReactNode }) {
  const qc = useQueryClient();
  const { data } = usePending();
  const kept = data?.find((p) => p.attemptId === attemptId);
  const resume = useMutation({
    mutationFn: () => uploadPending(kept!),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['attempt', attemptId] }), qc.invalidateQueries({ queryKey: KEY })]),
  });
  const del = useMutation({
    mutationFn: async () => {
      await api.del(`/attempts/${attemptId}`);
      if (kept) await deletePending(kept.key);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['attempts'] }), qc.invalidateQueries({ queryKey: KEY })]);
      onDeleted();
    },
  });
  return (
    <>
      {kept ? (
        <Button size="sm" icon={<RotateCcw />} loading={resume.isPending} onClick={() => resume.mutate()}>
          Resume upload
        </Button>
      ) : (
        recordAgain
      )}
      <Button size="sm" variant="ghost" icon={<Trash2 />} loading={del.isPending} onClick={() => del.mutate()}>
        Delete
      </Button>
      {(resume.error || del.error) && <span className="w-full text-xs text-bad-text">{(resume.error ?? del.error)!.message}</span>}
    </>
  );
}
