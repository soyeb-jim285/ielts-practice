/** Plays one rendered examiner line and resolves when it ends. No controls: it cannot be paused or sped up. A missing url, a load error, a blocked autoplay or an abort resolve at once, so the test never waits on audio. */
export function playLine(url: string | null | undefined, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!url || signal.aborted) return resolve();
    const a = new Audio(url);
    const done = () => {
      signal.removeEventListener('abort', done);
      a.onended = a.onerror = null;
      a.pause();
      resolve();
    };
    a.onended = a.onerror = done;
    signal.addEventListener('abort', done, { once: true });
    a.play().catch(done);
  });
}
