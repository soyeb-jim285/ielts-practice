import type { PronunciationAudio } from '@server/ai/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Play, Volume2 } from 'lucide-react';
import { Section, StatList } from '@/components/result';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { AudioControls } from './AudioBar';

type Word = PronunciationAudio['words'][number];
type Dict = { uk?: string; us?: string; ipa?: string };

/** Human recordings and IPA from Wiktionary, through the Free Dictionary API (free, no key, CORS open). Names and rare forms are often missing: {}. */
export async function lookupWord(word: string): Promise<Dict> {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
  if (!r.ok) return {};
  const entries = (await r.json()) as { phonetic?: string; phonetics?: { text?: string; audio?: string }[] }[];
  const ph = entries.flatMap((e) => e.phonetics ?? []);
  const audio = (accent: string) => ph.find((p) => p.audio?.endsWith(`-${accent}.mp3`))?.audio;
  return { uk: audio('uk'), us: audio('us') ?? (audio('uk') ? undefined : ph.find((p) => p.audio)?.audio), ipa: entries[0]?.phonetic ?? ph.find((p) => p.text)?.text };
}

const clips = new Map<string, HTMLAudioElement>();
/** A dictionary recording, loaded ahead (preload) so the first tap plays at once. */
const clip = (url: string) => {
  let a = clips.get(url);
  if (!a) {
    a = new Audio(url);
    a.preload = 'auto';
    clips.set(url, a);
  }
  return a;
};
const dictQuery = (word: string) => ({
  queryKey: ['dictionary', word.toLowerCase()],
  queryFn: async () => {
    const d = await lookupWord(word);
    for (const url of [d.uk, d.us]) if (url) clip(url);
    return d;
  },
  staleTime: Infinity,
  retry: false,
});
/** Looks up every listed word (and starts loading its recordings) when the result opens, so the Pronunciation tab has them ready. */
export function usePreloadPronunciation(pron?: PronunciationAudio) {
  const qc = useQueryClient();
  useEffect(() => {
    for (const w of pron?.words ?? []) void qc.prefetchQuery(dictQuery(w.word));
  }, [pron, qc]);
}

/** The browser's own voice, for words with no recording. Free and on the device; quality depends on the device. */
function speak(word: string, accent: 'gb' | 'us') {
  if (!('speechSynthesis' in window)) return;
  const lang = accent === 'gb' ? 'en-GB' : 'en-US';
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang;
  u.rate = 0.85;
  u.voice = speechSynthesis.getVoices().find((v) => v.lang === lang) ?? null;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** How to make the sound that was expected, for the swaps learners make most. Keyed by espeak IPA. */
const TIPS: Record<string, string> = {
  θ: 'Put your tongue lightly between your teeth and blow air out. No stop, no burst.',
  ð: 'Tongue lightly between your teeth, then add your voice so it buzzes.',
  v: 'Touch your top teeth to your bottom lip and let it buzz. Rounded lips make a /w/ instead.',
  w: 'Round your lips into a small circle, then open them. Your teeth do not touch your lip.',
  f: 'Top teeth on your bottom lip, then blow. Your lips do not close.',
  p: 'Close both lips, then release a puff of air.',
  r: 'Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.',
  ɹ: 'Curl your tongue back without touching the roof of your mouth. Do not roll or tap it.',
  l: 'Press the tip of your tongue behind your top teeth and let the air pass at the sides.',
  ɪ: 'A short, relaxed sound, as in "sit". Do not stretch it into "seat".',
  'iː': 'A long sound with spread lips, as in "seat". Hold it a little longer than "sit".',
  æ: 'Open your mouth wide and spread your lips, as in "cat". Not "ket".',
  e: 'Mouth half open, as in "bed". Less open than "bad".',
  ɛ: 'Mouth half open, as in "bed". Less open than "bad".',
  ʌ: 'Short and central, as in "cup". Your lips stay relaxed, not rounded.',
  ɒ: 'Short with rounded lips and an open mouth, as in "hot" (UK).',
  ʃ: 'Round your lips a little and push them forward, as in "she". Flat lips make an /s/.',
  s: 'Tongue close behind your top teeth, lips spread, a thin hiss.',
  z: 'The /s/ position with your voice on, so it buzzes.',
  ʒ: 'The /ʃ/ position with your voice on, as in "measure".',
  dʒ: 'Start with the tongue touching behind your teeth, then release into a buzzing "zh", as in "job".',
  tʃ: 'Start with the tongue touching behind your teeth, then release into "sh", as in "chip".',
  ŋ: 'Lift the back of your tongue to the soft palate and let the sound go through your nose. Do not add a /g/ at the end.',
  h: 'A light breath from the throat, as in "hat". Do not drop it.',
};

/** Pronunciation tab: the phoneme model's findings, each word with your clip and a correct recording. */
export function PronunciationPanel({ pron, audio }: { pron: PronunciationAudio; audio: AudioControls }) {
  return (
    <div className="space-y-10">
      <Section title="Summary" caption="A phoneme model listened to your recording and compared each sound with US and UK English, counting whichever is closer. It does not change your band yet.">
        <StatList
          cols={2}
          items={[
            { label: 'Sounds said as expected', value: pron.accuracy == null ? 'n/a' : `${Math.round(pron.accuracy)} / 100` },
            { label: 'Words to practise', value: pron.words.length },
          ]}
        />
      </Section>
      {pron.confusions.length > 0 && (
        <Section title="Sounds you mix up most" caption="Only sounds you swapped more than once. A single slip is not a pattern, and an accent is not an error.">
          <ul className="flex flex-wrap gap-2">
            {pron.confusions.map((c) => (
              <li key={`${c.expected}>${c.heard}`} className="type-body rounded-full border border-line bg-surface px-3 py-1">
                <span className="font-ipa">/{c.expected}/ → <span className="text-bad-text">/{c.heard}/</span></span>
                <span className="type-caption ml-1.5">{c.count} times</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Words to practise" caption={pron.words.length ? 'Worst first. Play your version, then the correct one, and say it again.' : undefined}>
        {pron.words.length ? (
          <ul className="max-w-[72ch] divide-y divide-line">
            {pron.words.map((w) => (
              <WordRow key={w.word} w={w} audio={audio} />
            ))}
          </ul>
        ) : (
          <p className="type-body">No word stood out. Every content word was close to US or UK English.</p>
        )}
      </Section>
    </div>
  );
}

function Phones({ w, k }: { w: Word; k: 'expected' | 'heard' }) {
  return (
    <span className="font-ipa">
      /{w.phones.map((p, i) => (
        <span key={i} className={cn(!p.ok && (k === 'expected' ? 'rounded-sm bg-good-soft px-px text-good-text' : 'rounded-sm bg-bad-soft px-px text-bad-text'))}>
          {p[k]}
        </span>
      ))}/
    </span>
  );
}

function WordRow({ w, audio }: { w: Word; audio: AudioControls }) {
  const dict = useQuery(dictQuery(w.word));
  const first: 'gb' | 'us' = w.accent === 'us' ? 'us' : 'gb'; // the accent the model found closer plays first
  const recordings = (first === 'gb' ? (['gb', 'us'] as const) : (['us', 'gb'] as const)).flatMap((a) => {
    const url = dict.data?.[a === 'gb' ? 'uk' : 'us'];
    return url ? [{ a, url }] : [];
  });
  const tip = w.phones.find((p) => !p.ok && TIPS[p.expected]);
  return (
    <li className="grid gap-x-6 gap-y-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="type-subheading">{w.word}</p>
        <dl className="type-body mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <dt className="type-caption self-center">Correct</dt>
          <dd><Phones w={w} k="expected" />{dict.data?.ipa && <span className="type-caption font-ipa ml-2">dictionary {dict.data.ipa}</span>}</dd>
          <dt className="type-caption self-center">You said</dt>
          <dd><Phones w={w} k="heard" /></dd>
        </dl>
        {tip && <p className="type-body mt-2 max-w-[60ch] text-muted">{TIPS[tip.expected]}</p>}
      </div>
      <div className="flex flex-wrap content-start gap-2 sm:w-40 sm:flex-col sm:items-stretch">
        <Button variant="outline" size="sm" onClick={() => audio.seek(w.start, w.end + 0.3)}>
          <Play aria-hidden /> Your version
        </Button>
        {recordings.map((r) => (
          <Button key={r.a} variant="secondary" size="sm" onClick={() => { const a = clip(r.url); a.currentTime = 0; void a.play().catch(() => speak(w.word, r.a)); }}>
            <Volume2 aria-hidden /> Correct · {r.a === 'gb' ? 'UK' : 'US'}
          </Button>
        ))}
        {!dict.isPending && !recordings.length && (
          <Button variant="secondary" size="sm" onClick={() => speak(w.word, first)}>
            <Volume2 aria-hidden /> Browser voice
          </Button>
        )}
        <span className="type-caption">{dict.isPending ? 'Looking up…' : recordings.length ? 'Recording: Wiktionary' : 'No dictionary recording'}</span>
      </div>
    </li>
  );
}
