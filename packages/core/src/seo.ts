/** Page titles, descriptions and share images. The server writes them into the HTML for crawlers and link previews
 *  (which do not run the SPA); the web app sets the same title as you navigate. */
export const SITE_NAME = 'IELTS Practice';
export const SITE_TAGLINE = 'Free IELTS practice with instant band scores';

export type PageMeta = { title: string; description: string; image: string; index: boolean };

const DEFAULT: PageMeta = {
  title: `${SITE_NAME}: ${SITE_TAGLINE}`,
  description:
    'Practise IELTS Speaking, Writing, Listening and Reading online. Timed tests in the real exam format, an AI examiner, and band scores for every criterion with each mistake marked.',
  image: '/og/home.png',
  index: true,
};

/** Public pages worth indexing; everything else (results, history, settings, exam screens) gets a title but noindex. */
const PAGES: Record<string, Omit<PageMeta, 'index'>> = {
  '/': DEFAULT,
  '/speaking': {
    title: `IELTS Speaking practice test with band score | ${SITE_NAME}`,
    description:
      'Answer real-format IELTS Speaking Part 1, 2 and 3 questions read aloud by an examiner, or talk to a live AI examiner. Get a band for fluency, vocabulary, grammar and pronunciation, with every pause and mistake marked.',
    image: '/og/speaking.png',
  },
  '/writing': {
    title: `IELTS Writing Task 1 & 2 practice with feedback | ${SITE_NAME}`,
    description:
      'Write IELTS Academic and General Training Task 1 and Task 2 answers under exam timing. Get a band for each criterion, the errors in your essay, and a rewrite one band higher.',
    image: '/og/writing.png',
  },
  '/listening': {
    title: `IELTS Listening practice tests online | ${SITE_NAME}`,
    description:
      'Full IELTS Listening tests with real-exam audio and timing, or one part at a time. Instant score and band, the transcript at each answer, and spelling practice for what you missed.',
    image: '/og/listening.png',
  },
  '/reading': {
    title: `IELTS Reading practice tests, Academic & General | ${SITE_NAME}`,
    description:
      'Full IELTS Academic and General Training Reading tests, or one passage at a time. Instant band, where each answer is in the passage, and True/False/Not Given analysis.',
    image: '/og/reading.png',
  },
  '/bank': {
    title: `IELTS question bank: Speaking & Writing topics | ${SITE_NAME}`,
    description: 'Browse hundreds of IELTS Speaking cue cards, Part 1 and Part 3 topics, and Writing Task 1 and Task 2 questions, and practise any of them.',
    image: '/og/home.png',
  },
  '/signup': { title: `Create your free account | ${SITE_NAME}`, description: DEFAULT.description, image: DEFAULT.image },
  '/privacy': {
    title: `Privacy policy | ${SITE_NAME}`,
    description: 'What IELTS Practice collects, how session recording works, who sees it, and how long it is kept.',
    image: DEFAULT.image,
  },
  '/login': { title: `Sign in | ${SITE_NAME}`, description: DEFAULT.description, image: DEFAULT.image },
};

const NOINDEX_TITLES: [RegExp, string][] = [
  [/^\/speaking\/(session|live)/, 'Speaking test'],
  [/^\/speaking\/result/, 'Speaking result'],
  [/^\/writing\/(task|full)/, 'Writing test'],
  [/^\/writing\/result/, 'Writing result'],
  [/^\/lr\/run/, 'Test in progress'],
  [/^\/lr\/result/, 'Test result'],
  [/^\/history/, 'History'],
  [/^\/review/, 'Review cards'],
  [/^\/mistakes/, 'Mistakes'],
  [/^\/settings/, 'Settings'],
  [/^\/admin/, 'Admin'],
  [/^\/(forgot|reset)-password/, 'Reset password'],
];

/** Paths listed in sitemap.xml. */
export const SITEMAP_PATHS = ['/', '/speaking', '/writing', '/listening', '/reading', '/bank'];

export function pageMeta(path: string): PageMeta {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const page = PAGES[p];
  if (page) return { ...page, index: p !== '/login' };
  const named = NOINDEX_TITLES.find(([re]) => re.test(p));
  return { ...DEFAULT, title: named ? `${named[1]} | ${SITE_NAME}` : DEFAULT.title, index: false };
}
