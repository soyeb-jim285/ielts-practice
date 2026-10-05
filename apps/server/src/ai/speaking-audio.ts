import { createHash } from 'node:crypto';

/** Object key of a rendered examiner line (scripts/gen-speaking-audio.py writes the same name). */
export const speakingAudioHash = (text: string) => createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
export const speakingAudioKey = (text: string) => `speaking/${speakingAudioHash(text)}.mp3`;

import { speakingLines } from '@ielts/core';
import { storage } from '../storage';

const MANIFEST = 'speaking/manifest.json'; // uploaded by scripts/speaking-audio-import.ts: {hash: key} of the rendered lines
let have: { at: number; hashes: Set<string>; found: boolean } | undefined;
export const forgetRenderedAudio = () => void (have = undefined); // tests, and right after an import
async function loadRendered() {
  if (have && Date.now() - have.at < 300_000) return have;
  let hashes = new Set<string>();
  let found = false;
  try {
    hashes = new Set(Object.keys(JSON.parse(new TextDecoder().decode(await storage.get(MANIFEST))) as Record<string, string>));
    found = true;
  } catch {
    // not imported yet: no examiner audio, the clients run the test silently
  }
  have = { at: Date.now(), hashes, found };
  return have;
}
const rendered = async () => (await loadRendered()).hashes;
/** Hashes of the rendered lines; null when the manifest has not been imported (admin content stats). */
export const renderedHashes = async () => {
  const r = await loadRendered();
  return r.found ? r.hashes : null;
};

export type AudioLine = { text: string; url: string | null };
export type PromptAudio = { intro: AudioLine | null; lead: AudioLine; questions: AudioLine[] };

/** Presigned examiner audio for a generated speaking prompt (url null where a line is not rendered). Cambridge prompts have none. */
export async function promptAudio(p: { part: number; type: string; topic: string; title: string; body: string; followUps?: string[] | null; source: string }): Promise<PromptAudio | null> {
  if (p.source !== 'generated') return null;
  const hashes = await rendered();
  const line = async (text: string): Promise<AudioLine> => ({ text, url: hashes.has(speakingAudioHash(text)) ? await storage.presignGet(speakingAudioKey(text)) : null });
  const l = speakingLines(p);
  return { intro: l.intro ? await line(l.intro) : null, lead: await line(l.lead), questions: await Promise.all(l.questions.map(line)) };
}
