import { useRef, useState } from 'react';
import { Slider } from '@/components/ui';
import { formatBand } from '@/lib/format';
import { useMe } from '@/lib/query';
import { useUpdateSettings } from './useUpdateSettings';

/** Target band slider; saves 400 ms after the thumb settles. */
export function TargetBandSlider({ hint }: { hint?: string }) {
  const [value, setValue] = useState(useMe().data?.settings.targetBand ?? 7);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { mutate } = useUpdateSettings();
  const change = (v: number) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => mutate({ targetBand: v }), 400);
  };
  return <Slider label="Target band" min={4} max={9} step={0.5} value={value} onChange={change} format={formatBand} hint={hint} />;
}
