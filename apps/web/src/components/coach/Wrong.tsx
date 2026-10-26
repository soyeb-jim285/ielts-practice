import { Flag } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui';
import type { Feedback } from './data';

/** "This is wrong" for one coach item: text on focus items, a flag icon on dense lines (pattern and cheat rows). */
export function Wrong({ fb, itemKey, what, compact }: { fb: Feedback; itemKey: string; what: string; compact?: boolean }) {
  const label = `This is wrong: ${what}`;
  if (compact)
    return (
      <Tooltip content="This is wrong">
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => fb.wrong(itemKey)} className="shrink-0 text-muted hover:text-ink">
          <Flag aria-hidden />
        </Button>
      </Tooltip>
    );
  return (
    <Button variant="ghost" size="sm" aria-label={label} onClick={() => fb.wrong(itemKey)} className="text-muted hover:text-ink">
      This is wrong
    </Button>
  );
}
