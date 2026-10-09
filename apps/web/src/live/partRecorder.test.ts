import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { usePartRecorder } from './turn';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
vi.mock('@/hooks/useRecorder', () => ({
  pickMime: () => '',
  useRecorder: () => ({
    start: async () => true,
    stop: async () => ({ blob: new Blob(['x']), mime: 'audio/webm', durationMs: 30_000, energy: [] }),
    pause: () => {},
    resume: () => {},
    clock: () => 0,
    stream: () => null,
    level: 0,
  }),
}));

const post = vi.mocked(api.post);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
});

it('sends each part as it ends; finish waits for those and sends only the rest', async () => {
  let failPart3 = true;
  post.mockImplementation(async (path: string, body?: unknown) => {
    if (path === '/live/upload-url') return { key: `k${Math.random()}`, uploadUrl: 'https://upload.test/x' };
    const b = body as { part?: { part: number }; parts?: { part: number }[] };
    if (path === '/live/part') {
      if (b.part!.part === 3 && failPart3) throw new Error('network');
      return { attemptId: `a${b.part!.part}` };
    }
    if (path === '/live/finish') return { attemptIds: ['a1', 'a2', 'a3'], sentWith: b.parts!.map((p) => p.part) };
    throw new Error(path);
  });
  const { result } = renderHook(() => usePartRecorder());
  act(() => result.current.session('s1'));
  await act(() => result.current.start(1));
  await act(() => result.current.start(3)); // starting Part 3 ends Part 1: it is sent now
  await act(() => result.current.stop()); // Part 3 ends: its send fails (network), so finish must send it
  const ids = await result.current.finish('s1');

  const parts = post.mock.calls.filter(([p]) => p === '/live/part').map(([, b]) => (b as { part: { part: number } }).part.part);
  expect(parts).toEqual([1, 3]);
  const finish = post.mock.calls.find(([p]) => p === '/live/finish')![1] as { parts: { part: number }[] };
  expect(finish.parts.map((p) => p.part)).toEqual([3]); // Part 1 is already analysing; only the failed Part 3 goes with finish
  expect(ids).toEqual(['a1', 'a2', 'a3']);
  failPart3 = false;
});
