/** Bound a live operation even if a transport never settles. Late results are ignored. */
export async function withDeadline<T>(operation: Promise<T>, ms = 45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The examiner took too long to respond. Please retry or score what you recorded.')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
