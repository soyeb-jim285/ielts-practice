import { describe, expect, it } from 'vitest';
import { clipWords } from './PromptTitle';

describe('clipWords', () => {
  it('keeps short text', () => expect(clipWords('Public transport', 48)).toBe('Public transport'));
  it('cuts on a word boundary', () => {
    const out = clipWords('Some people believe that shops should be made to throw them away', 48);
    expect(out).toBe('Some people believe that shops should be made…');
    expect(out.length).toBeLessThanOrEqual(49);
  });
});
