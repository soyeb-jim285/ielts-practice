/** Plays one examiner line and resolves when it ends. No controls: it cannot be paused or sped up.
 *  A line without a rendered recording (or whose recording fails to load) is read by the device voice instead, so the examiner always speaks:
 *  most generated prompts were never rendered and Cambridge prompts have no recordings (2026-10-26). An abort, a blocked autoplay or no speech
 *  support resolve at once, so the test never waits on audio. */
export function playLine(url: string | null | undefined, signal: AbortSignal, text?: string): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (!url) return speak(text, signal);
  return new Promise((resolve) => {
    const a = new Audio(url);
    const done = (fallback: boolean) => {
      signal.removeEventListener('abort', aborted);
      a.onended = a.onerror = null;
      a.pause();
      resolve(fallback ? speak(text, signal) : undefined);
    };
    const aborted = () => done(false);
    a.onended = () => done(false);
    a.onerror = () => done(true);
    signal.addEventListener('abort', aborted, { once: true });
    a.play().catch(() => done(false)); // autoplay blocked: speech would be blocked too
  });
}

/** Reads `text` with the device voice (British English when the device has one). */
function speak(text: string | undefined, signal: AbortSignal): Promise<void> {
  if (!text?.trim() || signal.aborted || typeof speechSynthesis === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    u.lang = u.voice?.lang ?? 'en-GB';
    // ponytail: some browsers never fire onend (long text, background tab); a timeout from the text length keeps the test moving.
    const timer = setTimeout(() => done(), 2000 + text.length * 90);
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      u.onend = u.onerror = null;
      resolve();
    };
    const stop = () => { speechSynthesis.cancel(); done(); };
    u.onend = u.onerror = () => done();
    signal.addEventListener('abort', stop, { once: true });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
