import { Info } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Popover as ShPopover, PopoverContent, PopoverTrigger } from './shadcn/popover';
import { Tooltip as ShTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './shadcn/tooltip';

/**
 * Hover/focus hint for a focusable child (button, link). Plain text only; interactive content → Popover.
 * Radix portals it, so it is never clipped by overflow:hidden parents. Touch devices don't fire hover: use InfoTip or a Popover there.
 */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom' }) {
  return (
    <TooltipProvider delayDuration={200}>
      <ShTooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-64">
          {content}
        </TooltipContent>
      </ShTooltip>
    </TooltipProvider>
  );
}

/** ⓘ button with an explanation, for metrics and jargon. Hover shows it on desktop; tap/click/Enter opens it everywhere (touch has no hover). */
export function InfoTip({ children, label = 'More info' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <ShPopover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
          className="hit inline-grid size-5 place-items-center rounded-full text-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" collisionPadding={8} onOpenAutoFocus={(e) => e.preventDefault()} className="w-auto max-w-64 rounded-lg bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background">
        {children}
      </PopoverContent>
    </ShPopover>
  );
}
