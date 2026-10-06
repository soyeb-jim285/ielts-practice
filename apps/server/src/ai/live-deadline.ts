import { AiError } from './openrouter';

/** Live speech cannot wait for the multi-minute analysis timeouts. */
export async function liveDeadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiError('timeout', 'The examiner took too long to respond. Please retry.')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
