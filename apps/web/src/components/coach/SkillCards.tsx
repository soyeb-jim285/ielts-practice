import type { SkillFacts } from '@server/coach/types';
import { BandNumeral, SKILLS } from '@/components/result';
import { Badge, Card, type Tone } from '@/components/ui';
import { formatBand, plural } from '@/lib/format';

const TREND: Record<SkillFacts['trend'], { text: string; tone: Tone }> = {
  improving: { text: 'Improving', tone: 'good' },
  steady: { text: 'Steady', tone: 'neutral' },
  slipping: { text: 'Slipping a little', tone: 'warn' },
  calibrating: { text: 'Still learning you', tone: 'info' },
};

/** Bands over time, 4 to 9 on the y axis; the dashed line is the target. Decorative: the numbers sit next to it. */
function Spark({ series, target, tone }: { series: SkillFacts['series']; target: number | null; tone: 'accent' | 'warn' | 'muted' }) {
  const y = (b: number) => 34 - ((Math.min(9, Math.max(4, b)) - 4) / 5) * 30 - 2;
  const pts = series.map((p, i) => `${series.length === 1 ? 50 : (i / (series.length - 1)) * 100},${y(p.band).toFixed(1)}`);
  const color = { accent: 'var(--accent)', warn: 'var(--warn)', muted: 'var(--muted)' }[tone];
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden className="h-9 w-full overflow-visible">
      {target != null && <line x1="0" x2="100" y1={y(target)} y2={y(target)} stroke="var(--line-strong)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      {pts.length > 1 && <polyline fill="none" stroke={color} strokeWidth="2" strokeDasharray={tone === 'muted' ? '4 3' : undefined} points={pts.join(' ')} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function targetLine(gap: number | null) {
  if (gap == null) return null;
  if (gap <= 0) return 'At target';
  return `${formatBand(gap)} below target`;
}

/** By skill: band (last 5), likely range, trend once there are 3 tests, distance to target when one is set. */
export function SkillCards({ skills, target }: { skills: SkillFacts[]; target: number | null }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {skills.map((s) => {
        const { label, Icon } = SKILLS[s.skill];
        const trend = TREND[s.trend];
        return (
          <li key={s.skill} className="min-w-0">
            <Card className="flex h-full flex-col gap-2 p-4">
              <p className="type-caption flex items-center gap-2">
                <Icon className="size-4" aria-hidden />
                {label}
              </p>
              {s.tests === 0 ? (
                <p className="type-body text-muted">No tests yet</p>
              ) : (
                <>
                  <div>
                    <BandNumeral value={s.band} size="standard" />
                    <p className="type-caption mt-0.5">
                      {s.range && `${formatBand(s.range[0])} to ${formatBand(s.range[1])} · `}
                      {s.tests >= 5 ? 'last 5 tests' : `${plural(s.tests, 'test')} so far`}
                    </p>
                  </div>
                  <Spark series={s.series} target={target} tone={s.trend === 'calibrating' ? 'muted' : s.trend === 'slipping' ? 'warn' : 'accent'} />
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={trend.tone} className="h-auto whitespace-normal py-0.5">
                      {trend.text}
                      {s.trend === 'calibrating' && ` · ${plural(s.needMore, 'more test')}`}
                    </Badge>
                    {targetLine(s.gap) && <span className="type-caption">{targetLine(s.gap)}</span>}
                  </div>
                </>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
