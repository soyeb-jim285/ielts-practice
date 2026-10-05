import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LrMark } from '@/lib/lr';
import { useLrSettings } from './LrSettings';
import { Marked, MarksProvider, readSelection, useMarkStore } from './Marks';

const partOf = () => 1;
const PARTS = [1];
function Harness({ id = 'a1', text = 'Hello brave new world' }: { id?: string; text?: string }) {
  const store = useMarkStore(id, PARTS, partOf);
  return (
    <MarksProvider store={store}>
      <p>
        <Marked region="passage:1:0" text={text} />
      </p>
      <button onClick={() => store.add({ id: 'n1', region: 'passage:1:0', p: 0, s: 6, e: 11, note: 'brave is an adjective', text: 'brave' })}>add note</button>
    </MarksProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('mark storage', () => {
  it('migrates old passage highlights on first read and keeps them', () => {
    localStorage.setItem('lr:a1:hl:1', JSON.stringify([{ p: 0, s: 0, e: 5 }]));
    const { container } = render(<Harness />);
    expect(container.querySelector('mark')?.textContent).toBe('Hello');
    const stored = JSON.parse(localStorage.getItem('lr:a1:marks:1')!) as LrMark[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ region: 'passage:1:0', s: 0, e: 5 });
    expect(stored[0]!.note).toBeUndefined();
  });
  it('a note survives a remount (reload) and gets a labelled marker', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByText('add note'));
    first.unmount();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Note: brave is an adjective' })).toBeTruthy();
    expect(document.querySelector('mark')?.textContent).toBe('brave');
  });
  it('is per attempt', () => {
    const first = render(<Harness id="a1" />);
    fireEvent.click(screen.getByText('add note'));
    first.unmount();
    const { container } = render(<Harness id="a2" />);
    expect(container.querySelector('mark')).toBeNull();
  });
  it('opens the note, then deletes it but keeps the highlight', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('add note'));
    fireEvent.click(screen.getByRole('button', { name: /^Note:/ }));
    expect(screen.getByText('brave is an adjective')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: /^Note:/ })).toBeNull();
    expect(document.querySelector('mark')?.textContent).toBe('brave');
  });
  it('never writes anything but the marks key (no answers or responses)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('add note'));
    expect(Object.keys(localStorage).sort()).toEqual(['lr:a1:marks:1']);
  });
});

describe('selection offsets', () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(); // jsdom has no layout
  it('reads offsets inside a region, trimmed, and ignores text outside one', () => {
    render(
      <div>
        <p id="in"><Marked region="passage:1:0" text="Hello brave new world" /></p>
        <p id="out">Plain text</p>
      </div>,
    );
    // Marked is plain text outside the provider, so give it a region element by hand.
    const p = document.getElementById('in')!;
    p.innerHTML = '<span data-region="q:3:text">Hello brave new world</span>';
    const node = p.firstElementChild!.firstChild!;
    const r = document.createRange();
    r.setStart(node, 5);
    r.setEnd(node, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    expect(readSelection()).toMatchObject({ region: 'q:3:text', p: 3, s: 6, e: 11, text: 'brave' });
    const o = document.createRange();
    o.selectNodeContents(document.getElementById('out')!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(o);
    expect(readSelection()).toBeNull();
  });
});

describe('settings', () => {
  it('persists per device and resets', () => {
    const { result } = renderHook(() => useLrSettings());
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS);
    act(() => result.current[1]({ size: 'xl' }));
    act(() => result.current[1]({ scheme: 'yb' }));
    expect(JSON.parse(localStorage.getItem('lr:settings')!)).toEqual({ size: 'xl', scheme: 'yb' });
    expect(renderHook(() => useLrSettings()).result.current[0]).toEqual({ size: 'xl', scheme: 'yb' });
    act(() => result.current[1](DEFAULT_SETTINGS));
    expect(JSON.parse(localStorage.getItem('lr:settings')!)).toEqual(DEFAULT_SETTINGS);
  });
});
