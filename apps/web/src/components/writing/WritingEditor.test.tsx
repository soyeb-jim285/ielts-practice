import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { countWords, WritingEditor } from './WritingEditor';

function Harness({ blockPaste }: { blockPaste: boolean }) {
  const [v, setV] = useState('');
  return <WritingEditor value={v} onChange={setV} blockPaste={blockPaste} minWords={150} />;
}

afterEach(cleanup);

describe('WritingEditor', () => {
  it('disables every writing assist', () => {
    render(<Harness blockPaste />);
    const ta = screen.getByLabelText('Your answer');
    expect(ta.getAttribute('spellcheck')).toBe('false');
    expect(ta.getAttribute('autocorrect')).toBe('off');
    expect(ta.getAttribute('autocapitalize')).toBe('off');
    expect(ta.getAttribute('autocomplete')).toBe('off');
    expect(ta.getAttribute('data-gramm')).toBe('false');
    expect(ta.getAttribute('data-gramm_editor')).toBe('false');
    expect(ta.getAttribute('data-enable-grammarly')).toBe('false');
  });

  it('prevents paste only when blockPaste is on', () => {
    const { unmount } = render(<Harness blockPaste />);
    expect(fireEvent.paste(screen.getByLabelText('Your answer'))).toBe(false);
    unmount();
    render(<Harness blockPaste={false} />);
    expect(fireEvent.paste(screen.getByLabelText('Your answer'))).toBe(true);
  });

  it('updates the live word count', () => {
    render(<Harness blockPaste />);
    expect(screen.getByText('0 words')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'The chart  shows\nfour trends.' } });
    expect(screen.getByText('5 words')).toBeTruthy();
    expect(screen.getByText('145 to go · min 150')).toBeTruthy();
  });

  it('counts words on whitespace', () => {
    expect(countWords('  ')).toBe(0);
    expect(countWords('well-known  data,\tsuch as')).toBe(4);
  });
});
