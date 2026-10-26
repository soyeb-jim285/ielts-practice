import { Check } from 'lucide-react';
import { Card } from '@/components/ui';

/** Where you are: the model's 2-3 sentences, worded from computed facts only. */
export function Summary({ text }: { text: string }) {
  return (
    <Card tone="hero">
      <p className="type-overline text-accent-text">Where you are</p>
      <p className="type-reading mt-2 max-w-[65ch] text-ink">{text}</p>
    </Card>
  );
}

/** At most one win: something that stopped happening, or a skill that really moved. */
export function Win({ text }: { text: string }) {
  return (
    <Card className="flex items-start gap-3 border-good/25 bg-good-soft shadow-none">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-good-text ring-1 ring-good/30">
        <Check className="size-4" />
      </span>
      <p className="type-body text-ink">
        <strong className="font-semibold">Going well: </strong>
        {text}
      </p>
    </Card>
  );
}
