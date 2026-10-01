import { expect, it } from 'vitest';
import { PcmPlayer } from './pcmPlayer';

function fakeCtx() {
  const started: { at: number; dur: number; stopped: boolean }[] = [];
  const ctx = {
    currentTime: 1,
    destination: {} as AudioNode,
    createBuffer: (_c: number, n: number, rate: number) => ({ duration: n / rate, copyToChannel() {} }) as unknown as AudioBuffer,
    createBufferSource: () => {
      const rec = { at: 0, dur: 0, stopped: false };
      started.push(rec);
      const src: any = {
        buffer: null,
        onended: null,
        connect() {},
        start(at: number) {
          rec.at = at;
          rec.dur = src.buffer.duration;
        },
        stop() {
          rec.stopped = true;
        },
      };
      return src as AudioBufferSourceNode;
    },
  };
  return { ctx, started };
}

it('schedules chunks back to back after a 30 ms lead, and reports the queue', () => {
  const { ctx, started } = fakeCtx();
  const p = new PcmPlayer(ctx);
  p.push(new Int16Array(2400)); // 100 ms at 24 kHz
  p.push(new Int16Array(2400));
  expect(started[0]!.at).toBeCloseTo(1.03);
  expect(started[1]!.at).toBeCloseTo(1.13);
  expect(p.queued).toBeCloseTo(0.23);
  ctx.currentTime = 2; // everything has played: the next chunk starts with the lead again
  expect(p.queued).toBe(0);
  p.push(new Int16Array(240));
  expect(started[2]!.at).toBeCloseTo(2.03);
});

it('flush stops everything that is queued and restarts the clock', () => {
  const { ctx, started } = fakeCtx();
  const p = new PcmPlayer(ctx);
  p.push(new Int16Array(2400));
  p.push(new Int16Array(2400));
  p.flush();
  expect(started.every((s) => s.stopped)).toBe(true);
  expect(p.queued).toBe(0);
  p.push(new Int16Array(0)); // empty chunks are ignored
  expect(started).toHaveLength(2);
});
