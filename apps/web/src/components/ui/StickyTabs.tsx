import type { ReactNode } from 'react';

/**
 * Sticky in-page tab bar (result pages). Solid page background that bleeds over the shell gutters (`--gutter`, set by AppShell) so the
 * underline spans the full column and nothing scrolls visibly behind it. z-20 = "sticky in-page bar", below the sidebar and tab bar (30).
 */
export function StickyTabs({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-20 -mx-(--gutter,0px) bg-bg px-(--gutter,0px)">{children}</div>;
}
