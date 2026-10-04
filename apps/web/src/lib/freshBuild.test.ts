import { expect, it } from 'vitest';
import { entryOf } from './freshBuild';

it('reads the hashed entry script of a built index.html, and nothing in dev', () => {
  expect(entryOf('<script type="module" crossorigin src="/assets/index-BHEHuBUP.js"></script>')).toBe('/assets/index-BHEHuBUP.js');
  expect(entryOf('<script type="module" src="/src/main.tsx"></script>')).toBeUndefined();
});
