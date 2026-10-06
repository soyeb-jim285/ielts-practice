import { X } from 'lucide-react';
import { ErrorDetails } from '@/components/results';
import { Button, Card } from '@/components/ui';
import { formatClock } from '@/lib/format';
import type { Marker, MarkerType } from '@/lib/timeline';
import type { AudioControls } from './AudioBar';

/** One style per mistake type, shared by the pace chart, the audio bar and the transcript. Colour plus shape (and underline style in text), so it reads without colour. Teal is never used here: it means the playhead. */
export const TYPE_STYLE: Record<MarkerType, { label: string; color: string; underline: string }> = {
  grammar: { label: 'Grammar', color: 'var(--bad)', underline: 'decoration-bad decoration-solid' },
  vocabulary: { label: 'Vocabulary', color: 'var(--warn)', underline: 'decoration-warn decoration-dashed' },
  pronunciation: { label: 'Pronunciation', color: 'var(--sky)', underline: 'decoration-sky decoration-dotted' },
  fluency: { label: 'Fluency', color: 'var(--chart-3)', underline: 'decoration-chart-3 decoration-wavy' },
};

/** The type's shape (circle, square, triangle, diamond) as SVG, centred on x,y; fill is set by the parent. */
export function ShapeEl({ type, x = 5, y = 5, r = 4 }: { type: MarkerType; x?: number; y?: number; r?: number }) {
  if (type === 'grammar') return <circle cx={x} cy={y} r={r} />;
  if (type === 'vocabulary') return <rect x={x - r * 0.85} y={y - r * 0.85} width={r * 1.7} height={r * 1.7} />;
  const pts = type === 'pronunciation' ? [[x, y - r], [x + r, y + r * 0.8], [x - r, y + r * 0.8]] : [[x, y - r * 1.2], [x + r * 1.2, y], [x, y + r * 1.2], [x - r * 1.2, y]];
  return <polygon points={pts.map((p) => p.join(',')).join(' ')} />;
}

export function MarkerShape({ type, size = 10, className }: { type: MarkerType; size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 10 10" fill={TYPE_STYLE[type].color} className={className}>
      <ShapeEl type={type} />
    </svg>
  );
}

export const markerLabel = (m: Marker) => `${TYPE_STYLE[m.type].label} mistake at ${formatClock(Math.floor(m.t))}: ${m.label}`;

/** The picked mistake: the existing error detail for errors, a one-line note for fluency and pronunciation events. */
export function MarkerDetail({ marker, audio }: { marker: Marker; audio: AudioControls }) {
  return (
    <Card className="space-y-3" aria-live="polite">
      <div className="flex items-center gap-2">
        <MarkerShape type={marker.type} />
        <span className="type-subheading">{TYPE_STYLE[marker.type].label}</span>
        <span className="type-caption type-num">{formatClock(Math.floor(marker.t))}</span>
        <Button size="icon" variant="ghost" aria-label="Close" className="ml-auto" onClick={() => audio.clear()}>
          <X />
        </Button>
      </div>
      {marker.error ? <ErrorDetails error={marker.error} onPlay={() => audio.seek(marker.t, (marker.end ?? marker.t + 2) + 0.3)} /> : <p className="type-body">{marker.label}</p>}
    </Card>
  );
}
