export const PAUSE_MS = 250, LONG_PAUSE_MS = 1000, UNCLEAR_CONF = 0.6, WPM_WINDOW_S = 10, WPM_HOP_S = 5, VOICED_GAP_MS = 300;
export const WRITING_SECONDS = { t1: 1200, t2: 2400, full: 3600 } as const;
export const MIN_WORDS = { t1: 150, t2: 250 } as const;
export const SPEAKING_ZONES = { 1: { min: 15, max: 40 }, 2: { min: 60, good: 90, max: 120 }, 3: { min: 30, max: 60 } } as const;
export const P2_PREP_S = 60;
/** Questions asked per Part 1 topic in a full test (bank topics have 5). */
export const P1_TEST_QUESTIONS = 4;
export const FILLERS: string[] = ['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'like', 'you know', 'i mean', 'sort of', 'kind of'];
export const LINKERS: string[] = [
  'moreover', 'furthermore', 'in addition', 'however', 'therefore', 'firstly', 'secondly', 'finally', 'on the other hand',
  'in conclusion', 'additionally', 'consequently', 'nevertheless', 'for example', 'for instance', 'as a result', 'thus',
  'hence', 'although', 'whereas',
];
