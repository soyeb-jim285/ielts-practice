import { api, ApiError } from '@/lib/api';

/** A finished recording that has not reached the server yet. Kept in IndexedDB from the moment recording stops until the upload is confirmed, so a failure, reload or closed tab never loses it. */
export type Pending = {
  key: string;
  promptId: string;
  part: 1 | 2 | 3;
  label: string;
  createdAt: number;
  mime: string;
  blob: Blob;
  durationMs: number;
  energy: number[];
  marks: number[];
  /** Non-live: answer window of each question within the recording (ms). */
  segments?: { q: number; startMs: number; endMs: number }[];
  sessionId?: string;
  parentAttemptId?: string;
  /** Set when the recording is a speaking section of a mock test. */
  mockId?: string;
  // upload progress, so a retry resumes at the step that failed
  attemptId?: string;
  uploadUrl?: string;
  uploaded?: boolean;
};

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('ielts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending', { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const r = f(db.transaction('pending', mode).objectStore('pending'));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).finally(() => db.close());
};

/** false when storage is unavailable (private window, quota): the recording then only lives in this tab. */
export const savePending = (p: Pending) => run('readwrite', (s) => s.put(p)).then(() => true, () => false);
export const listPending = () => run<Pending[]>('readonly', (s) => s.getAll()).catch((): Pending[] => []);
export const deletePending = (key: string) => run('readwrite', (s) => s.delete(key)).catch(() => {});

const PUT_MS = 30_000;
const API_MS = 15_000;

const timeout = (what: string) => new Error(`${what} timed out. Your recording is kept on this device, so retry.`);
const within = <T>(p: Promise<T>, ms: number, what: string) => {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(timeout(what)), ms)))]).finally(() => clearTimeout(t));
};

/** Create the attempt, PUT the audio, submit. Every step has a hard timeout; progress is saved after each step. Resolves to the attempt id and drops the local copy. */
export async function uploadPending(p: Pending, kept = true): Promise<string> {
  const save = () => (kept ? savePending(p) : undefined);
  if (!p.attemptId) {
    const created = await within(
      api.post<{ id: string; uploadUrl?: string }>('/attempts', { promptId: p.promptId, skill: 'speaking', part: p.part, mode: 'practice', sessionId: p.sessionId, parentAttemptId: p.parentAttemptId, ...(p.mockId && { mockId: p.mockId }), audioContentType: p.mime }),
      API_MS,
      'Starting the upload',
    );
    Object.assign(p, { attemptId: created.id, uploadUrl: created.uploadUrl });
    await save();
  }
  if (!p.uploaded) {
    const put = await fetch(p.uploadUrl!, { method: 'PUT', body: p.blob, headers: { 'content-type': p.mime }, signal: AbortSignal.timeout(PUT_MS) }).catch((e: Error) => {
      throw e.name === 'TimeoutError' ? timeout('Uploading the audio') : new Error("Couldn't reach the server. Your recording is kept on this device, so retry when you are online.");
    });
    if (!put.ok) throw new Error(`The audio upload was rejected (${put.status}). Your recording is kept on this device, so retry.`);
    p.uploaded = true;
    await save();
  }
  // 409 = an earlier submit already went through (its response was lost).
  await within(api.post(`/attempts/${p.attemptId}/submit`, { durationMs: p.durationMs, energy: p.energy, marks: p.marks, segments: p.segments }), API_MS, 'Submitting').catch((e) => {
    if (!(e instanceof ApiError && e.status === 409)) throw e;
  });
  await deletePending(p.key);
  return p.attemptId!;
}
