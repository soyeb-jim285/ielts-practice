import { expect, it } from 'vitest';
import { SPEAKING_WELCOMES, speakingLines, speakingWelcome } from './speaking-audio';

const p1 = (slug: string) => ({ slug, part: 1, type: 'p1-intro', topic: 'Hometown', title: 'Hometown', body: 'Where is it?', followUps: ['Where is it?'] });

it('the welcome is one of the variants, stable per opening prompt and spread across the bank', () => {
  expect(speakingLines(p1('p1-frame-home-1')).intro).toBe(speakingWelcome('p1-frame-home-1'));
  expect(speakingLines(p1('p1-frame-home-1')).intro).toBe(speakingLines(p1('p1-frame-home-1')).intro);
  const used = new Set(Array.from({ length: 40 }, (_, i) => speakingWelcome(`p1-frame-${i}`)));
  expect(used).toEqual(new Set(SPEAKING_WELCOMES));
  expect(speakingWelcome()).toBe(SPEAKING_WELCOMES[0]);
  // pre-rendered audio can't know the hour: no time-of-day greeting; every variant leads into Part 1 the real way
  for (const w of SPEAKING_WELCOMES) expect(w).toMatch(/^Hello\b.*first part.*questions about yourself\.$/);
  expect(speakingLines({ ...p1('x'), part: 3, type: 'p3-linked' }).intro).toBeUndefined();
});
