const STAGES: Record<string, string> = {
  stt: 'Transcription',
  disfluency: 'Disfluency',
  pronunciation: 'Pronunciation',
  score: 'Scoring',
  feedback: 'Feedback',
  examiner_llm: 'Examiner reply',
  examiner_tts: 'Examiner voice',
  live_realtime: 'Live realtime',
};
export const stageLabel = (s: string) => STAGES[s] ?? s.replace(/_/g, ' ');

/** Money for a cost page: cents for big sums, four decimals for the tiny per-call amounts so they never show as $0.00. */
export const usdFine = (n: number | null | undefined) => (n == null ? '-' : n === 0 ? '$0' : Math.abs(n) < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Ledger kind to words for the waste panel. */
export const WASTE_LABEL: Record<string, string> = {
  failed: 'Failed calls',
  retry: 'Retries',
  discarded_stt: 'Discarded primed transcription',
  extra_samples: 'Extra scoring samples',
  failed_attempt: 'Failed or refunded attempts',
};

/** "Left" for an empty ledger: nothing to chart, say when tracking starts. */
export const trackedSince = (since: string | null) => (since ? `Per-call costs are recorded from ${new Date(since).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })}.` : 'No costs recorded yet. They start with the next analysis.');
