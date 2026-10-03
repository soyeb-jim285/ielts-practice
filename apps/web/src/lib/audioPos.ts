import { lsGet, lsSet } from './lr';

/** Practice listening resume state: saved position (seconds) per part, and the chosen speed. Lives in the attempt's stats.audio. */
export type AudioState = { pos: Record<string, number>; rate?: number };
export type AudioResume = { start: number; rate?: number; set: (pos: number, rate: number) => void; save: () => void };

const RATES = [0.75, 1, 1.25];
const key = (id: string) => `lr:${id}:audio`;

/** Where to put the playhead: within 3 s of the end (or unknown) means the part was finished, so start over. */
export const resumePosition = (pos: number, dur: number) => (pos > 1 && Number.isFinite(dur) && pos < dur - 3 ? pos : 0);

/** Drops anything the server would reject (non-finite, out of range, unknown speed). */
export function cleanAudio(a: AudioState): AudioState {
  const pos: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.pos)) if (/^\d$/.test(k) && Number.isFinite(v)) pos[k] = Math.round(Math.min(3600, Math.max(0, v)) * 10) / 10;
  return { pos, ...(a.rate !== undefined && RATES.includes(a.rate) && { rate: a.rate }) };
}

export const saveAudioLocal = (id: string, a: AudioState) => lsSet(key(id), cleanAudio(a));

// ponytail: this device's copy wins over the server's (it is never older than what this device last played); no per-part timestamps
export function loadAudio(id: string, server?: AudioState | null): AudioState | undefined {
  const local = lsGet<AudioState | null>(key(id), null);
  return local ? cleanAudio(local) : server ? cleanAudio(server) : undefined;
}
