import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Passage, headingOf } from './Passage';

const section: any = { part: 1, passage: { title: 'T', paragraphs: [{ text: '### Library hours' }, { text: 'Open:\n• Mon\n• Tue' }] }, groups: [] };

describe('Passage', () => {
  it('parses heading markers', () => {
    expect(headingOf('### Library hours')).toBe('Library hours');
    expect(headingOf('Plain')).toBeNull();
  });
  it('renders a heading paragraph as a heading, not highlightable text', () => {
    const { container } = render(<Passage section={section} />);
    expect(screen.getByRole('heading', { name: 'Library hours', level: 3 })).toBeTruthy();
    expect(container.textContent).not.toContain('###');
    expect(container.querySelectorAll('[data-p]').length).toBe(1);
    expect(container.querySelector('[data-p="1"]')?.textContent).toBe('Open:\n• Mon\n• Tue');
  });
});
