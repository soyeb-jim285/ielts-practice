import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request provider credentials. The OpenRouter calls in openrouter.ts read this instead of taking a key parameter, so every call site
 *  (analysis, scoring, STT, TTS, audio pronunciation, turn-based live) uses the user's own key without threading it through. docs/community.md */
export type KeyCtx = {
  /** The user's own OpenRouter key. Unset: the shared community key. */
  openrouter?: string;
  /** Called once when the provider rejects that key (401/403), so it can be flagged invalid. */
  onAuthFail?: () => void;
};
export const keyCtx = new AsyncLocalStorage<KeyCtx>();

/** Replaces every secret in `text` (upstream error bodies, messages) so keys never reach a log or a response. */
export function redact(text: string, ...secrets: (string | undefined)[]) {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[redacted]');
  return out;
}
