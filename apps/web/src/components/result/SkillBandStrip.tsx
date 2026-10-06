import { Link, type LinkProps } from '@tanstack/react-router';
import { BookOpen, ChevronRight, Headphones, Mic, PenLine, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BandMeter } from './BandMeter';
import { BandNumeral } from './BandNumeral';

export type SkillKey = 'listening' | 'reading' | 'writing' | 'speaking';
export const SKILLS: Record<SkillKey, { label: string; Icon: LucideIcon }> = {
  listening: { label: 'Listening', Icon: Headphones },
  reading: { label: 'Reading', Icon: BookOpen },
  writing: { label: 'Writing', Icon: PenLine },
  speaking: { label: 'Speaking', Icon: Mic },
};

export type SkillBandItem = {
  skill: SkillKey;
  band: number | null;
  /** Results behind the band: >1 reads "average of last n", 1 reads "latest". */
  n?: number;
  to?: LinkProps;
  /** Caption under the band (meta, "Take a test"); replaces the n caption. In the guest variant, the one-line offer. */
  offer?: ReactNode;
  /** Text shown instead of the band when it has none ("Not tried", "Being marked"). Default "Not tried". */
  state?: ReactNode;
  target?: number;
};

/** Index of the lowest band among items that have one; null unless at least two have a band. Ties go to the first. */
export function weakestSkill(items: { band: number | null }[]): number | null {
  const withBand = items.map((it, i) => [it.band, i] as const).filter(([b]) => b != null) as (readonly [number, number])[];
  if (withBand.length < 2) return null;
  return withBand.reduce((m, c) => (c[0] < m[0] ? c : m))[1];
}

/** The four-skill row of the dashboard, the guest page and the mock result. 4-up from lg, 2x2 below; a cell with `to` is one link. */
export function SkillBandStrip({ items, variant = 'dashboard' }: { items: SkillBandItem[]; variant?: 'dashboard' | 'guest' }) {
  const weak = variant === 'dashboard' ? weakestSkill(items) : null;
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
      {items.map((it, i) => {
        const { label, Icon } = SKILLS[it.skill];
        const inner =
          variant === 'guest' ? (
            <div className="space-y-2">
              <Icon className="size-4 text-muted" aria-hidden />
              <h3 className="type-subheading">{label}</h3>
              <p className="type-caption">{it.offer}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="type-caption flex items-center gap-2">
                <Icon className="size-4" aria-hidden />
                <span>{label}</span>
                {it.to && <ChevronRight className="ml-auto size-4 max-sm:hidden" aria-hidden />}
              </p>
              {it.band != null ? <BandNumeral value={it.band} size="standard" /> : <p className="type-body text-muted min-h-[1.875rem]">{it.state ?? 'Not tried'}</p>}
              {it.band != null && <BandMeter band={it.band} target={it.target} label={`${label} band`} />}
              <div className="min-h-10">
                {weak === i && <p className="type-caption font-medium text-warn-text">Weakest skill</p>}
                <p className="type-caption">{it.offer ?? (it.n != null && it.band != null ? (it.n > 1 ? `average of last ${it.n}` : 'latest') : null)}</p>
              </div>
            </div>
          );
        return (
          <li key={it.skill} className="min-w-0">
            {it.to ? (
              <Link {...it.to} className="-m-2 block min-h-11 rounded-md p-2 transition-colors duration-[120ms] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
