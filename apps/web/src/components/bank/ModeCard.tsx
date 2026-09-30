import { Link, type LinkProps } from '@tanstack/react-router';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonStyles } from '@/components/ui';
import { cn } from '@/lib/utils';

export const EASE = 'ease-[cubic-bezier(0.25,1,0.5,1)]';

type Content = { tone?: 'brand'; kind: string; title: string; body: string; meta: string; cta: string; visual: ReactNode };
type Action = { link: LinkProps } | { onClick: () => void; loading?: boolean; disabled?: boolean };

/** One way to practise (speaking and writing hubs). The whole card is the link or button; sibling cards share size, structure and interaction.
 *  Hover/focus: 2px lift, brand border, tinted shadow, and the card's visual plays (the only motion, so it signals "this is what happens").
 *  Visuals react through the `group/mode` name. */
export function ModeCard(props: Content & Action) {
  const { tone, kind, title, body, meta, cta, visual } = props;
  const loading = 'onClick' in props && props.loading;
  const className = cn(
    'group/mode flex flex-col gap-6 rounded-lg border p-6 text-left outline-none transition-[translate,box-shadow,border-color,opacity] duration-200 sm:p-7',
    EASE,
    'hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_10px_28px_-14px_rgb(15_118_110/0.45)] focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 motion-reduce:hover:translate-y-0 motion-reduce:focus-visible:translate-y-0',
    'disabled:pointer-events-none disabled:opacity-60',
    tone === 'brand' ? 'border-brand/20 bg-accent-soft' : 'border-line bg-card',
  );
  const inner = (
    <>
      <div>
        <p className="type-caption">{kind}</p>
        <h2 className="type-title-sm mt-2">{title}</h2>
        <p className="type-lede mt-2 max-w-[46ch]">{body}</p>
      </div>
      <div className="mt-auto">{visual}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="type-caption type-num">{meta}</span>
        <span className={buttonStyles({ variant: tone === 'brand' ? 'primary' : 'outline', className: 'pointer-events-none' })}>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {cta}
          {!loading && <ArrowRight aria-hidden className={cn('transition-transform duration-200 group-hover/mode:translate-x-0.5 motion-reduce:transition-none', EASE)} />}
        </span>
      </div>
    </>
  );
  if ('link' in props) {
    return (
      <Link {...props.link} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} aria-busy={loading || undefined} className={className}>
      {inner}
    </button>
  );
}
