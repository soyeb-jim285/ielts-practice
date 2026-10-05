import { Highlighter, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Kbd, Sheet, Textarea } from '@/components/ui';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/shadcn/popover';
import { addMark, markRuns, newMarkId, notedAt, NOTE_MAX, lsGet, lsSet, migrateHighlights, parseMarks, removeMark, setMarkNote, type Highlight, type LrMark } from '@/lib/lr';
import { cn } from '@/lib/utils';

// ---------- store: all marks of one attempt, persisted per part in localStorage (never sent anywhere) ----------
const key = (attemptId: string, part: number) => `lr:${attemptId}:marks:${part}`;

export function useMarkStore(attemptId: string, parts: number[], partOf: (region: string) => number | undefined) {
  const [marks, setMarks] = useState<LrMark[]>(() =>
    parts.flatMap((part) => {
      const raw = lsGet<unknown>(key(attemptId, part), null);
      return raw === null ? migrateHighlights(part, lsGet<Highlight[]>(`lr:${attemptId}:hl:${part}`, [])) : parseMarks(raw);
    }),
  );
  useEffect(() => {
    for (const part of parts) lsSet(key(attemptId, part), marks.filter((m) => partOf(m.region) === part));
  }, [attemptId, parts, partOf, marks]);
  return useMemo(
    () => ({
      marks,
      add: (m: LrMark) => setMarks((all) => addMark(all, m)),
      setNote: (id: string, note: string) => setMarks((all) => setMarkNote(all, id, note)),
      remove: (id: string) => setMarks((all) => removeMark(all, id)),
    }),
    [marks],
  );
}
export type MarkStore = ReturnType<typeof useMarkStore>;

// ---------- selection → region + offsets ----------
type Sel = { region: string; p: number; s: number; e: number; text: string; rect: DOMRect };
const regionOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('[data-region]') ?? null;
const offsetIn = (el: HTMLElement, node: Node, off: number) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, off);
  return r.toString().length;
};
/** The region number a mark belongs to: paragraph (passage), question or group. */
const numberOf = (region: string) => Number(region.split(':')[region.startsWith('passage') ? 2 : 1]) || 0;

/** The current text selection if it sits in a markable region (a selection running past the region is cut at its end). Never inside inputs. */
export function readSelection(): Sel | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const a = regionOf(r.startContainer);
  if (!a) return null;
  const full = a.textContent ?? '';
  let s = offsetIn(a, r.startContainer, r.startOffset);
  let e = regionOf(r.endContainer) === a ? offsetIn(a, r.endContainer, r.endOffset) : full.length;
  while (s < e && /\s/.test(full[s]!)) s++;
  while (e > s && /\s/.test(full[e - 1]!)) e--;
  if (e <= s) return null;
  const region = a.dataset.region!;
  return { region, p: numberOf(region), s, e, text: full.slice(s, e), rect: r.getBoundingClientRect() };
}

// ---------- context: rendering marks inside the test content ----------
type Mode = 'menu' | 'view' | 'edit';
type Ctx = { marks: LrMark[]; show: (id: string, el: Element, mode: Mode) => void; remove: (id: string) => void };
const MarksCtx = createContext<Ctx | null>(null);
const hasSelection = () => !!window.getSelection() && !window.getSelection()!.isCollapsed;
/** A click that ends a text selection inside a label must not toggle its answer. */
export const keepSelection = (e: { preventDefault: () => void }) => hasSelection() && e.preventDefault();

/** Text of one region with its marks drawn. Outside the runner (results, review) it is plain text. */
export function Marked({ region, text, className }: { region: string; text: string; className?: string }) {
  const c = useContext(MarksCtx);
  if (!c) return <>{text}</>;
  const mine = c.marks.filter((m) => m.region === region);
  const runs = markRuns(text.length, mine);
  const primary = (r: { marks: LrMark[] }) => r.marks.find((m) => m.note) ?? r.marks[0]!;
  const seen = new Set<string>();
  return (
    <span data-region={region} className={className}>
      {runs.map((r) => {
        const body = text.slice(r.s, r.e);
        if (!r.marks.length) return <Fragment key={r.s}>{body}</Fragment>;
        const p = primary(r);
        const first = !seen.has(p.id);
        seen.add(p.id);
        const markers = r.marks.filter((m) => m.note && m.e === r.e);
        return (
          <Fragment key={r.s}>
            <mark
              className="lr-mark"
              data-mark={r.marks.map((m) => m.id).join(' ')}
              tabIndex={first ? 0 : -1}
              aria-label={first ? `Highlighted${p.note ? ' with note' : ''}: ${text.slice(p.s, p.e)}` : undefined}
              onClick={(e) => {
                if (hasSelection()) return;
                e.preventDefault(); // inside a choice <label>, don't also pick the option
                c.show(p.id, e.currentTarget, 'menu');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') c.show(p.id, e.currentTarget, 'menu');
                else if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  c.remove(p.id);
                }
              }}
            >
              {body}
            </mark>
            {markers.map((m) => (
              <button key={m.id} type="button" data-replay-block data-note-marker={m.id} aria-label={`Note: ${m.note!.slice(0, 40)}`} onClick={(e) => c.show(m.id, e.currentTarget, 'view')} className="hit lr-note-marker">
                <StickyNote className="size-3.5" aria-hidden />
              </button>
            ))}
          </Fragment>
        );
      })}
    </span>
  );
}

// ---------- provider: selection popover, mark menu, note editor ----------
type Anchor = { getBoundingClientRect: () => DOMRect };
type UI = { anchor: Anchor; kind: 'select' | Mode; id?: string; sel?: Sel };

export function MarksProvider({ store, children }: { store: MarkStore; children: ReactNode }) {
  const { marks } = store;
  const [ui, setUi] = useState<UI | null>(null);
  const anchor = useRef<Anchor>({ getBoundingClientRect: () => new DOMRect() });
  const pointer = useRef('mouse');
  const live = useRef({ marks, store });
  live.current = { marks, store };
  const close = useCallback(() => setUi(null), []);
  const open = useCallback((next: UI) => {
    anchor.current = next.anchor;
    setUi(next);
  }, []);

  const highlight = useCallback(
    (sel: Sel) => {
      const noted = notedAt(live.current.marks, sel.region, sel.s, sel.e);
      if (noted) return open({ anchor: anchor.current, kind: 'edit', id: noted.id });
      live.current.store.add({ id: newMarkId(), region: sel.region, p: sel.p, s: sel.s, e: sel.e, text: sel.text.slice(0, 160) });
      window.getSelection()?.removeAllRanges();
      close();
    },
    [open, close],
  );
  const note = useCallback(
    (sel: Sel) => {
      const noted = notedAt(live.current.marks, sel.region, sel.s, sel.e);
      open({ anchor: anchor.current, kind: 'edit', id: noted?.id, sel: noted ? undefined : sel });
    },
    [open],
  );

  // selection → popover (mouse up, touch selection, right click), Alt+H / Alt+N
  useEffect(() => {
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-slot=popover-content], input, textarea, select');
    const select = (at?: { x: number; y: number }) => {
      const sel = readSelection();
      if (!sel) return false;
      open({ anchor: at ? { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) } : { getBoundingClientRect: () => sel.rect }, kind: 'select', sel });
      return true;
    };
    const onUp = (e: PointerEvent) => {
      pointer.current = e.pointerType;
      if (!inUi(e.target)) setTimeout(select, 0);
    };
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(t);
      if (pointer.current === 'touch') t = setTimeout(select, 350);
    };
    const onMenu = (e: MouseEvent) => !inUi(e.target) && readSelection() && (e.preventDefault(), select({ x: e.clientX, y: e.clientY }));
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.code !== 'KeyH' && e.code !== 'KeyN')) return;
      const sel = readSelection();
      if (!sel) return;
      e.preventDefault();
      anchor.current = { getBoundingClientRect: () => sel.rect };
      if (e.code === 'KeyH') highlight(sel);
      else note(sel);
    };
    document.addEventListener('pointerup', onUp);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, highlight, note]);

  const ctx = useMemo<Ctx>(
    () => ({ marks, show: (id, el, kind) => open({ anchor: el, kind, id }), remove: (id) => live.current.store.remove(id) }),
    [marks, open],
  );
  const target = ui?.id ? marks.find((m) => m.id === ui.id) : undefined;
  const returnTo = useRef<string | undefined>(undefined);
  if (ui?.id) returnTo.current = ui.id;

  return (
    <MarksCtx.Provider value={ctx}>
      {children}
      <Popover open={!!ui && (ui.kind === 'select' || ui.kind === 'edit' || !!target)} onOpenChange={(o) => !o && close()}>
        <PopoverAnchor virtualRef={anchor} />
        <PopoverContent
          data-replay-block
          side="top"
          align="center"
          collisionPadding={8}
          sideOffset={8}
          aria-label="Highlight and notes"
          onOpenAutoFocus={(e) => ui?.kind === 'select' && e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const id = returnTo.current;
            returnTo.current = undefined;
            if (id) document.querySelector<HTMLElement>(`[data-note-marker="${id}"], [data-mark~="${id}"]`)?.focus();
          }}
          className={cn('w-auto max-w-[min(20rem,calc(100vw-1rem))] p-1.5', ui?.kind === 'edit' && 'w-[min(20rem,calc(100vw-1rem))] p-3')}
        >
          {ui?.kind === 'select' && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Highlighter />} onClick={() => highlight(ui.sel!)}>
                Highlight <Kbd className="hidden sm:inline-flex">Alt H</Kbd>
              </Button>
              <Button size="sm" variant="ghost" icon={<StickyNote />} onClick={() => note(ui.sel!)}>
                Add note <Kbd className="hidden sm:inline-flex">Alt N</Kbd>
              </Button>
            </div>
          )}
          {ui?.kind === 'menu' && target && (
            <div className="flex flex-col gap-0.5">
              <Button size="sm" variant="ghost" className="justify-start" icon={<Pencil />} onClick={() => open({ anchor: anchor.current, kind: 'edit', id: target.id })}>
                {target.note ? 'Edit note' : 'Add note'}
              </Button>
              <Button size="sm" variant="ghost" className="justify-start" icon={<Trash2 />} onClick={() => (store.remove(target.id), close())}>
                Remove highlight
              </Button>
            </div>
          )}
          {ui?.kind === 'view' && target && (
            <div className="space-y-2.5 p-1.5">
              <p className="type-overline">Note</p>
              <p className="type-body whitespace-pre-wrap">{target.note}</p>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => open({ anchor: anchor.current, kind: 'edit', id: target.id })}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => (store.setNote(target.id, ''), close())}>
                  Delete
                </Button>
              </div>
            </div>
          )}
          {ui?.kind === 'edit' && (
            <NoteForm
              key={ui.id ?? 'new'}
              initial={target?.note ?? ''}
              quote={target ? (target.text ?? '') : ui.sel?.text}
              onCancel={close}
              onSave={(text) => {
                if (target) store.setNote(target.id, text);
                else if (ui.sel && text.trim()) store.add({ id: newMarkId(), region: ui.sel.region, p: ui.sel.p, s: ui.sel.s, e: ui.sel.e, note: text.trim().slice(0, NOTE_MAX), text: ui.sel.text.slice(0, 160) });
                window.getSelection()?.removeAllRanges();
                close();
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </MarksCtx.Provider>
  );
}

function NoteForm({ initial, quote, onSave, onCancel }: { initial: string; quote?: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      {quote && <p className="type-caption line-clamp-2 border-l-2 border-line-strong pl-2 italic">{quote}</p>}
      <Textarea
        label="Note"
        hideLabel
        autoFocus
        rows={3}
        maxLength={NOTE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), onSave(text))}
        placeholder="Write a note"
        hint={`${text.length} of ${NOTE_MAX}. Notes stay on this device.`}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

// ---------- Notes panel: every mark of the attempt ----------
export function NotesPanel({ open, onClose, store, locate, canJump, onJump, returnFocusRef }: { open: boolean; onClose: () => void; store: MarkStore; locate: (m: LrMark) => string; canJump: (m: LrMark) => boolean; onJump: (m: LrMark) => void; returnFocusRef?: React.RefObject<HTMLElement | null> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const list = [...store.marks].sort((a, b) => a.region.localeCompare(b.region, undefined, { numeric: true }) || a.s - b.s);
  const notes = list.filter((m) => m.note).length;
  return (
    <Sheet open={open} onClose={onClose} title="Notes" returnFocusRef={returnFocusRef} description={`${list.length} highlighted ${list.length === 1 ? 'passage' : 'passages'}, ${notes} with ${notes === 1 ? 'a note' : 'notes'}. Kept on this device only.`}>
      {list.length === 0 ? (
        <p className="type-caption py-6">Nothing highlighted yet. Select text in the test, then choose Highlight or Add note.</p>
      ) : (
        <ul data-replay-block className="space-y-3 pb-2">
          {list.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-card p-3">
              <p className="type-overline">{locate(m)}</p>
              <p className="type-body mt-1.5 line-clamp-3 border-l-2 border-warn pl-2 italic">{m.text || 'Highlighted text'}</p>
              {editing === m.id ? (
                <div className="mt-2.5">
                  <NoteForm
                    initial={m.note ?? ''}
                    onCancel={() => setEditing(null)}
                    onSave={(t) => {
                      store.setNote(m.id, t);
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                m.note && <p className="type-body mt-2 whitespace-pre-wrap">{m.note}</p>
              )}
              {editing !== m.id && (
                <div className="mt-2 flex flex-wrap gap-1 max-md:gap-2">
                  <Button size="sm" variant="outline" disabled={!canJump(m)} title={canJump(m) ? undefined : 'Opens when the recording reaches that part'} onClick={() => onJump(m)}>
                    Show in test
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(m.id)}>
                    {m.note ? 'Edit note' : 'Add note'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => store.remove(m.id)}>
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
