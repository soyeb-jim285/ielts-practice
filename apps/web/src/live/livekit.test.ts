import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LIVEKIT } from '@ielts/core';
import { api } from '@/lib/api';
import { LiveKitDuplex, loadLiveKitConfig } from './livekit';

const mock = vi.hoisted(() => ({ listeners: {} as Record<string, (...args: any[]) => void>, publish: vi.fn(), mic: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), stop: vi.fn(), startAudio: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
vi.mock('livekit-client', () => ({
  ParticipantKind: { AGENT: 4 }, RoomEvent: { DataReceived: 'data', Disconnected: 'disconnect', TrackSubscribed: 'track', TrackUnsubscribed: 'untrack' },
  Room: class {
    localParticipant = { publishData: mock.publish, setMicrophoneEnabled: mock.mic, trackPublications: new Map([['mic', { track: { stop: mock.stop } }]]) };
    on(event: string, fn: (...args: any[]) => void) { mock.listeners[event] = fn; return this; }
    connect = mock.connect; disconnect = mock.disconnect; startAudio = mock.startAudio;
  },
}));
const agent = { kind: 4, identity: 'agent' };
const event = (value: object, participant = agent, topic = 'ielts.events') => mock.listeners.data!(new TextEncoder().encode(JSON.stringify(value)), participant, undefined, topic);
const handlers = () => ({ speaking: vi.fn(), caption: vi.fn(), answered: vi.fn(), lost: vi.fn(), pending: vi.fn(), heard: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api.post).mockResolvedValue({ url: 'wss://room', token: 'secret', roomName: 'r', participantIdentity: 'candidate' });
  mock.connect.mockImplementation(async () => event({ type: 'ready' })); mock.mic.mockResolvedValue(undefined); mock.disconnect.mockResolvedValue(undefined);
  mock.publish.mockResolvedValue(undefined); mock.startAudio.mockResolvedValue(undefined);
});
it('starts after mic publication, catches synchronous readiness and sends reliable controls in order', async () => {
  const d = new LiveKitDuplex(DEFAULT_LIVEKIT); await d.connect(handlers(), 's');
  d.configurePart(2); d.cue('Topic', false, 'part2'); d.listen(false, true);
  await vi.waitFor(() => expect(mock.publish).toHaveBeenCalledTimes(4));
  expect(mock.mic).toHaveBeenCalledWith(true);
  expect(mock.publish.mock.calls.map(([data]) => JSON.parse(new TextDecoder().decode(data)))).toEqual([{ type: 'start' }, { type: 'configure', part: 2 }, { type: 'cue', text: 'Topic', key: 'part2' }, { type: 'listen', on: false, fresh: true }]);
  expect(mock.publish.mock.calls[0]![1]).toEqual({ reliable: true, topic: 'ielts.control' }); d.close();
});
it('ignores spoofed participants and topics and maps whole captions without duplication', async () => {
  const h = handlers(), d = new LiveKitDuplex(DEFAULT_LIVEKIT); await d.connect(h, 's');
  event({ type: 'caption', text: 'spoof' }, { kind: 0, identity: 'candidate' });
  event({ type: 'caption', text: 'spoof' }, agent, 'other');
  event({ type: 'caption', text: 'Hello' }); event({ type: 'heard', text: 'Answer' }); event({ type: 'pending', on: true }); event({ type: 'answered' }); event({ type: 'speaking', on: true }); event({ type: 'cost', usd: 0.03 });
  expect(h.caption.mock.calls).toEqual([['', false], ['Hello', true]]);
  expect(h.heard).toHaveBeenCalledWith('Answer'); expect(h.pending).toHaveBeenCalledWith(true); expect(h.answered).toHaveBeenCalledOnce();
  expect(d.stats.costUsd).toBe(0.03); expect(d.stats.timeline[0]!.label).toContain('LiveKit'); d.close();
});
it('cleans up on mic failure and unexpected disconnect', async () => {
  mock.mic.mockRejectedValueOnce(new Error('blocked'));
  const d = new LiveKitDuplex(DEFAULT_LIVEKIT); await expect(d.connect(handlers(), 's')).rejects.toThrow('blocked'); expect(mock.stop).toHaveBeenCalled();
  const h = handlers(), next = new LiveKitDuplex(DEFAULT_LIVEKIT); await next.connect(h, 's'); mock.listeners.disconnect!(); expect(h.lost).toHaveBeenCalledOnce(); expect(mock.disconnect).toHaveBeenCalled();
});
it('times out a silent worker and stops tracks', async () => {
  vi.useFakeTimers();
  try {
    mock.connect.mockResolvedValue(undefined);
    const result = new LiveKitDuplex(DEFAULT_LIVEKIT).connect(handlers(), 's');
    const rejected = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_001); await rejected;
    expect(mock.stop).toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('stops a microphone that finishes publishing after close', async () => {
  let resolve!: () => void;
  mock.mic.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
  const d = new LiveKitDuplex(DEFAULT_LIVEKIT), result = d.connect(handlers(), 's');
  const rejected = expect(result).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(mock.mic).toHaveBeenCalled());
  d.close(); mock.stop.mockClear(); resolve(); await rejected;
  expect(mock.stop).toHaveBeenCalled();
});
it('surfaces startup agent errors and restores safe storage defaults', async () => {
  mock.connect.mockImplementationOnce(async () => event({ type: 'error', message: 'provider unavailable' }));
  await expect(new LiveKitDuplex(DEFAULT_LIVEKIT).connect(handlers(), 's')).rejects.toThrow('provider unavailable');
  localStorage.setItem('admin-livekit-config', '{broken'); expect(loadLiveKitConfig()).toEqual(DEFAULT_LIVEKIT);
  localStorage.setItem('admin-livekit-config', JSON.stringify({ stt: 'elevenlabs' })); expect(loadLiveKitConfig().sttModel).toBe('scribe_v2_realtime');
});
it('survives iOS refusing audio playback outside a tap (mic first, unlock on next tap)', async () => {
  mock.startAudio.mockRejectedValueOnce(new DOMException('not allowed', 'NotAllowedError'));
  const h = handlers(), d = new LiveKitDuplex(DEFAULT_LIVEKIT);
  await d.connect(h, 's');
  expect(h.lost).not.toHaveBeenCalled();
  expect(d.stats.steps.map((s) => s.key)).toEqual(['load', 'token', 'connect', 'mic', 'audio', 'ready']);
  d.close();
});

it('streams sentence captions onto one line and fills the reply timeline from worker timings', async () => {
  const h = handlers(), d = new LiveKitDuplex(DEFAULT_LIVEKIT); await d.connect(h, 's');
  event({ type: 'caption', text: 'Thank you.' }); event({ type: 'caption', text: 'Where are you from?', append: true });
  expect(h.caption.mock.calls).toEqual([['', false], ['Thank you.', true], [' Where are you from?', true]]);
  event({ type: 'answered', eot: 0.9, stt: 0.3 }); event({ type: 'speaking', on: true });
  const t = d.stats.timeline[0]!;
  expect(t.stt).toBeCloseTo(300); expect(t.wait).toBeCloseTo(600);
  expect(t.total).toBeGreaterThanOrEqual(900); expect(d.replyMs).toBe(t.total);
  event({ type: 'turn', llm: 0.4, tts: 0.2 });
  expect(t.llm).toBeCloseTo(400); expect(t.tts).toBeCloseTo(200);
  expect(t.net).toBeCloseTo(Math.max(0, t.total - 1500));
  d.close();
});
