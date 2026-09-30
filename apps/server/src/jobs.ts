// Owned by the AI-pipeline agent. Contract: runAnalysis(attemptId) loads attempt, runs analyzeSpeaking/analyzeWriting,
// stores analyses + mistakes, sets status done|failed. Never throws.
let analyzer: (attemptId: string) => Promise<void> = async () => {
  throw new Error('analyzer not implemented');
};
export function setAnalyzer(fn: (attemptId: string) => Promise<void>) {
  analyzer = fn;
}
export function runAnalysis(attemptId: string): Promise<void> {
  return analyzer(attemptId);
}
export async function recoverStale(): Promise<void> {}
