import { expect, it } from 'vitest';
import fixture from './smartTurn.fixture.json';
import { smartTurnFeatures } from './smartTurn';

// The fixture is transformers' WhisperFeatureExtractor(chunk_length=8) on this exact signal, padded at the start to 8 s with do_normalize=True,
// as pipecat's inference.py does (generated in Python, 2026-10-14). Smart Turn only works if the browser feeds it the same features.
it('reproduces the Whisper log-mel features Smart Turn was trained on', () => {
  const sr = 16000, n = fixture.n;
  const sig = Float32Array.from({ length: n }, (_, i) => { const t = i / sr; return 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1375 * t) * Math.exp(-t); });
  const f = smartTurnFeatures(sig);
  let worst = 0;
  fixture.last.forEach((row, m) => row.forEach((v, j) => (worst = Math.max(worst, Math.abs(f[m * 800 + 800 - row.length + j]! - v)))));
  fixture.first.forEach((v, m) => (worst = Math.max(worst, Math.abs(f[m * 800]! - v))));
  expect(worst).toBeLessThan(2e-3);
});
