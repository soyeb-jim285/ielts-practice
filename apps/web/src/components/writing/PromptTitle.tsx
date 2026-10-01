/** Cut at the last whole word within `max` characters, with an ellipsis. Short text is returned as is. */
export const clipWords = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, '')}…`);

const MOBILE_CHARS = 48; // about two lines of the page title at 390px

/** The prompt as the page title: whole on sm+, clipped on a word boundary on phones until `open`. Pair with PromptToggle. */
export function PromptTitle({ title, open }: { title: string; open: boolean }) {
  if (title.length <= MOBILE_CHARS) return <>{title}</>;
  return (
    <>
      <span className="sm:hidden">{open ? title : clipWords(title, MOBILE_CHARS)}</span>
      <span className="max-sm:hidden">{title}</span>
    </>
  );
}

/** Phone-only "Show prompt" link for a clipped PromptTitle. */
export function PromptToggle({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  if (title.length <= MOBILE_CHARS) return null;
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="ml-2 min-h-11 text-accent-text underline underline-offset-2 sm:hidden">
      {open ? 'Hide prompt' : 'Show prompt'}
    </button>
  );
}
