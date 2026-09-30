import { useRef, useState } from 'react';
import { Slider } from '@/components/ui';
import { formatBand } from '@/lib/format';
import { useMe } from '@/lib/query';
import { useUpdateSettings } from './useUpdateSettings';

const SCALE = [4, 5, 6, 7, 8, 9];

/** Target band slider with a whole-band scale under the track; saves 400 ms after the thumb settles. */
export function TargetBandSlider({ hint }: { hint?: string }) {
  const [value, setValue] = useState(useMe().data?.settings.targetBand ?? 7);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { mutate } = useUpdateSettings();
  const change = (v: number) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => mutate({ targetBand: v }), 400);
  };
  const scale = (
    <>
      <span className="type-num flex justify-between px-1" aria-hidden>
        {SCALE.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
      {hint && <span className="mt-3 block">{hint}</span>}
    </>
  );
  return <Slider label="Target band" min={4} max={9} step={0.5} value={value} onChange={change} format={(v) => <span className="type-num text-lg font-semibold text-ink">{formatBand(v)}</span>} hint={scale} />;
}
