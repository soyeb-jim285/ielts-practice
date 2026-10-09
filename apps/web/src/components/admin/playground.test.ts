import { expect, it } from 'vitest';
import { addRealtimeUsage, emptyRealtimeUsage } from '@/live/realtime';
import { audioFormat, geminiUsd, gptLiveUsd, realtimeUsd, transcriptStats } from './playground';

it('counts fillers, immediate repetitions and the speaking rate without fillers', () => {
  const words = ['Um,', 'I', 'I', 'think', 'uh', 'the', 'city', 'is', 'is', 'big.'].map((w, i) => ({ w, start: i * 0.5, end: i * 0.5 + 0.4 }));
  expect(transcriptStats(words)).toEqual({ words: 10, fillers: 2, repeats: 2, wpm: Math.round((8 / 4.9) * 60) });
  expect(transcriptStats([])).toEqual({ words: 0, fillers: 0, repeats: 0, wpm: 0 });
});

it('maps recorder MIME types and file names to the upload format', () => {
  expect(audioFormat('audio/webm;codecs=opus')).toBe('webm');
  expect(audioFormat('audio/mp4')).toBe('m4a');
  expect(audioFormat('', 'clip.MP3')).toBe('mp3');
  expect(audioFormat('application/octet-stream', 'x.bin')).toBeNull();
});

it('prices the live engines', () => {
  expect(geminiUsd({ inputText: 1e6, inputAudio: 1e6, inputMedia: 0, outputText: 0, outputAudio: 1e6, thoughts: 1e6 })).toBeCloseTo(0.75 + 3 + 12 + 4.5);
  expect(gptLiveUsd(120)).toBeCloseTo(0.1);
  // response.done usage: cached tokens are inside the text/audio counts and are billed at the cached rate instead
  const u = addRealtimeUsage(emptyRealtimeUsage(), { input_token_details: { text_tokens: 1000, audio_tokens: 3000, cached_tokens: 1500, cached_tokens_details: { text_tokens: 500, audio_tokens: 1000 } }, output_token_details: { text_tokens: 100, audio_tokens: 400 } });
  expect(u).toEqual({ textIn: 500, audioIn: 2000, cachedIn: 1500, textOut: 100, audioOut: 400, transcribeSeconds: 0 });
  expect(realtimeUsd('gpt-realtime-mini', { ...u, transcribeSeconds: 60 })).toBeCloseTo((500 * 0.6 + 2000 * 10 + 1500 * 0.3 + 100 * 2.4 + 400 * 20) / 1e6 + 0.003);
});
