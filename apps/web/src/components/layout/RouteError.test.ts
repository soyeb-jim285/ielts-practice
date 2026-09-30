import { expect, test } from 'vitest';
import { notFoundCopy } from './RouteError';

test('maps server 404 messages to friendly copy', () => {
  expect(notFoundCopy('Attempt not found').body).toMatch(/deleted or belongs to another account/);
  expect(notFoundCopy('Prompt not found').title).toBe('Prompt not found');
  expect(notFoundCopy('').title).toBe('Not found');
});
