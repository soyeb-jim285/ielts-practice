import { Eye } from 'lucide-react';
import type { RefObject } from 'react';
import { Button, Kbd, Sheet } from '@/components/ui';

// Same wording on web, iOS and Android (docs/exam-fidelity.md).
const HELP: [string, string][] = [
  ['Navigation', 'Use the question numbers at the bottom to jump. Next and Back move one question. Part tabs switch parts (in Listening exam the recording moves parts for you).'],
  ['Flag for review', 'Flag a question you want to come back to. Flagged questions are marked in the navigator and listed when you submit.'],
  ['Highlight and notes', 'Select text and choose Highlight or Add note (long-press on touch). Tap a highlight to remove it or open its note. Notes are kept on this device and are never sent anywhere.'],
  ['Settings', 'Change text size and colours without affecting the timer.'],
  ['Hide', 'Covers the test. The clock keeps running (and the recording keeps playing in Listening).'],
  ['Submit', 'You can submit early. Unanswered questions are listed first.'],
];

export function HelpSheet({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  return (
    <Sheet open={open} onClose={onClose} title="Help" description="How this test works" returnFocusRef={returnFocusRef} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <ol className="space-y-4 pb-2">
        {HELP.map(([h, t], i) => (
          <li key={h} className="flex gap-3">
            <span aria-hidden className="type-num grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-sm font-semibold text-muted">{i + 1}</span>
            <div>
              <p className="type-subheading">{h}</p>
              <p className="type-body mt-0.5 text-pretty">{t}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 hidden rounded-lg border border-line bg-surface-2 p-3 sm:block">
        <p className="type-subheading mb-1.5">Keyboard</p>
        <ul className="type-caption space-y-1">
          <li><Kbd>Alt</Kbd> <Kbd>H</Kbd> highlight the selected text</li>
          <li><Kbd>Alt</Kbd> <Kbd>N</Kbd> add a note to the selected text</li>
          <li><Kbd>Enter</Kbd> on a highlight opens its menu, <Kbd>Delete</Kbd> removes it</li>
          <li><Kbd>Esc</Kbd> closes a popup or the Hide screen</li>
        </ul>
      </div>
    </Sheet>
  );
}

/** Covers the test. The clock and any recording keep running underneath; this only hides. */
export function HidePanel({ listening, onShow }: { listening: boolean; onShow: () => void }) {
  return (
    <div
      role="region"
      aria-label="Test hidden"
      onKeyDown={(e) => e.key === 'Escape' && onShow()}
      className="absolute inset-0 z-30 grid place-items-center bg-surface px-6 text-center"
    >
      <div className="max-w-sm">
        <Eye className="mx-auto mb-3 size-7 text-muted" aria-hidden />
        <h2 className="type-title-sm">Test hidden</h2>
        <p className="type-lede mt-2" role="status">
          The clock is still running.{listening ? ' The recording is still playing.' : ''}
        </p>
        <Button size="lg" className="mt-6" autoFocus onClick={onShow}>
          Show
        </Button>
      </div>
    </div>
  );
}
