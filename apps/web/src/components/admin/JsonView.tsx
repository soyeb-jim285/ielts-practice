import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A string that holds JSON (model output, prompts built with JSON.stringify) is shown as the structure it holds. */
export function parseJsonString(s: string): unknown {
  const t = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!/^[[{]/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

const KEY = 'text-accent-text';
const STR = 'text-good-text';
const NUM = 'text-sky-text';
const LIT = 'text-warn-text';

/**
 * Read-only JSON (each node's open state is styled by its own [open], not group-open, which nested nodes would inherit): syntax colours (keys, strings, numbers, true/false/null), objects and arrays fold with a count (native <details>, so keyboard and
 * screen readers work), multi-line strings keep their line breaks, and a string that holds JSON unfolds into it with a "JSON text" tag.
 */
export function JsonView({ value, open = 2, className, copy = true }: { value: unknown; open?: number; className?: string; copy?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className={cn('relative rounded-md border border-line bg-surface-2 font-mono text-[13px] leading-relaxed', className)}>
      {copy && (
        <button
          type="button"
          className="absolute top-1.5 right-1.5 z-10 inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={done ? 'Copied' : 'Copy JSON'}
          onClick={() => void navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2)).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
        >
          {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      )}
      <div className="overflow-x-auto p-3 pr-10">
        <Node v={value} depth={0} open={open} />
      </div>
    </div>
  );
}

function Node({ k, v, depth, open }: { k?: ReactNode; v: unknown; depth: number; open: number }) {
  const key = k != null && <span className={KEY}>{k}: </span>;
  if (v === null || typeof v === 'boolean') return <div>{key}<span className={LIT}>{String(v)}</span></div>;
  if (typeof v === 'number') return <div>{key}<span className={NUM}>{v}</span></div>;
  if (typeof v === 'string') {
    const inner = v.length > 1 ? parseJsonString(v) : undefined;
    if (inner !== undefined && typeof inner === 'object' && inner !== null)
      return <Branch k={k} v={inner} depth={depth} open={open} tag="JSON text" />;
    return (
      <div className="break-words whitespace-pre-wrap">
        {key}
        <span className={STR}>"{v}"</span>
      </div>
    );
  }
  if (typeof v === 'object') return <Branch k={k} v={v as object} depth={depth} open={open} />;
  return <div>{key}<span className="text-muted">{String(v)}</span></div>;
}

function Branch({ k, v, depth, open, tag }: { k?: ReactNode; v: object; depth: number; open: number; tag?: string }) {
  const arr = Array.isArray(v), entries = Object.entries(v);
  const [o, c] = arr ? ['[', ']'] : ['{', '}'];
  const head = (
    <>
      {k != null && <span className={KEY}>{k}: </span>}
      {tag && <span className="mr-1.5 rounded bg-accent-soft px-1 text-[11px] text-accent-text">{tag}</span>}
      <span className="text-muted">{o}</span>
    </>
  );
  if (!entries.length) return <div>{head}<span className="text-muted">{c}</span></div>;
  return (
    <details open={depth < open} className="[&[open]>summary>.chev]:rotate-90 [&[open]>summary>.count]:hidden">
      <summary className="cursor-pointer list-none rounded hover:bg-surface [&::-webkit-details-marker]:hidden">
        <span className="chev mr-1 inline-block w-3 text-muted transition-transform" aria-hidden>›</span>
        {head}
        <span className="count text-muted"> {entries.length} {arr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'} {c}</span>
      </summary>
      <div className="ml-1.5 border-l border-line pl-4">
        {entries.map(([ek, ev]) => (
          <Node key={ek} k={arr ? <span className="text-muted">{ek}</span> : ek} v={ev} depth={depth + 1} open={open} />
        ))}
      </div>
      <div className="text-muted">{c}</div>
    </details>
  );
}
