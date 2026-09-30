import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { loadAttempt, pollDelay, type Attempt } from './attempt';

describe('pollDelay', () => {
  it('backs off 2 s, 3 s, 5 s', () => {
    expect([0, 4, 5, 9, 10, 40].map(pollDelay)).toEqual([2000, 2000, 3000, 3000, 5000, 5000]);
  });
  it('makes about 12 calls in 40 s instead of 20', () => {
    let t = 0;
    let n = 0;
    while (t < 40_000) t += pollDelay(n++);
    expect(n).toBeLessThanOrEqual(13);
  });
});

describe('loadAttempt', () => {
  afterEach(() => vi.restoreAllMocks());
  const prev = { id: 'a', status: 'analyzing', stage: 'feedback' } as Attempt;
  const get = (status: object, full: object = {}) => vi.spyOn(api, 'get').mockImplementation(async (path: string) => (path.endsWith('/status') ? status : full) as never);

  it('polls only the status while the stage has not moved', async () => {
    const spy = get({ status: 'analyzing', stage: 'feedback' });
    expect(await loadAttempt('a', prev)).toBe(prev);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('fetches the whole attempt when the stage or status moves, and on the first load', async () => {
    const spy = get({ status: 'analyzing', stage: 'scoring' }, { id: 'a', stage: 'scoring' });
    expect(await loadAttempt('a', prev)).toEqual({ id: 'a', stage: 'scoring' });
    expect(spy).toHaveBeenLastCalledWith('/attempts/a');
    get({ status: 'done', stage: null }, { id: 'a', status: 'done' });
    expect(await loadAttempt('a', prev)).toEqual({ id: 'a', status: 'done' });
    vi.restoreAllMocks();
    const first = get({}, { id: 'a' });
    await loadAttempt('a');
    expect(first).toHaveBeenCalledTimes(1);
  });
});
