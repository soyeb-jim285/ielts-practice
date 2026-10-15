import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AudioControls } from './AudioBar';
import { lookupWord, PronunciationPanel } from './PronunciationPanel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const entry = [{ phonetic: '/θɪŋk/', phonetics: [{ text: '/θɪŋk/', audio: '' }, { audio: 'https://upload.wikimedia.org/think-uk.mp3' }, { audio: 'https://upload.wikimedia.org/think-us.mp3' }] }];

it('reads UK and US recordings and the IPA from the dictionary; a missing word is empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/think') ? new Response(JSON.stringify(entry)) : new Response('{}', { status: 404 }))));
  expect(await lookupWord('Think')).toEqual({ uk: 'https://upload.wikimedia.org/think-uk.mp3', us: 'https://upload.wikimedia.org/think-us.mp3', ipa: '/θɪŋk/' });
  expect(await lookupWord('Sylhet')).toEqual({});
});

it('shows each word with its swapped sound, plays the clip and offers the recordings', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(entry))));
  const seek = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PronunciationPanel
        audio={{ seek } as unknown as AudioControls}
        pron={{ accuracy: 81.6, wordsPerMinute: 140, confusions: [{ expected: 'θ', heard: 't', count: 3 }], words: [{ word: 'think', score: 40, accent: 'gb', start: 2, end: 2.4, phones: [{ expected: 'θ', heard: 't', ok: false }, { expected: 'ɪ', heard: 'ɪ', ok: true }] }] }}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('82 / 100')).toBeTruthy();
  expect(screen.getByText('3 times')).toBeTruthy();
  expect(screen.getByText(/tongue lightly between your teeth and blow/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Your version/ }));
  expect(seek).toHaveBeenCalledWith(2, expect.closeTo(2.7));
  expect(await screen.findByRole('button', { name: /Correct · UK/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Correct · US/ })).toBeTruthy();
});
