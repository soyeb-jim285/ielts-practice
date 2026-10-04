/** The hashed entry script of a built index.html ("/assets/index-<hash>.js"); undefined in dev. */
export const entryOf = (html: string) => /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];

/** True when the server now serves a different build than the one this tab runs. A tab opened before a deploy keeps the old
 *  code until reloaded (an iPhone kept recording WebM for minutes after the MP4 fix shipped). */
export async function isStale(): Promise<boolean> {
  const mine = entryOf(document.documentElement.outerHTML);
  if (!mine) return false;
  try {
    const latest = entryOf(await (await fetch('/', { cache: 'no-store' })).text());
    return !!latest && latest !== mine;
  } catch {
    return false; // offline: keep running
  }
}
