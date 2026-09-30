import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { uploadPending, type Pending } from './pendingRecordings';

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { post: vi.fn() } }));
const post = vi.mocked(api.post);

const pending = (): Pending => ({ key: 'k', promptId: 'p', part: 1, label: 'Part 1', createdAt: 0, mime: 'audio/webm', blob: new Blob(['x']), durationMs: 1000, energy: [], marks: [0] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  post.mockReset();
});

describe('uploadPending', () => {
  it('resumes at the failed step: a retry after a failed PUT does not create a second attempt', async () => {
    post.mockResolvedValueOnce({ id: 'a1', uploadUrl: '/put' }).mockResolvedValueOnce({});
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const p = pending();
    await expect(uploadPending(p, false)).rejects.toThrow(/reach the server/);
    expect(p.attemptId).toBe('a1');
    expect(p.uploaded).toBeFalsy();
    await expect(uploadPending(p, false)).resolves.toBe('a1');
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/attempts', '/attempts/a1/submit']);
  });

  it('gives up on a hung API call instead of spinning forever', async () => {
    vi.useFakeTimers();
    post.mockReturnValue(new Promise(() => {}));
    const out = expect(uploadPending(pending(), false)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(16_000);
    await out;
  });

  it('reports a rejected PUT with its status', async () => {
    post.mockResolvedValueOnce({ id: 'a1', uploadUrl: '/put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(uploadPending(pending(), false)).rejects.toThrow(/rejected \(403\)/);
  });
});
