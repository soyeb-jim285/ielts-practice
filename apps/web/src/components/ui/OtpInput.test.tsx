import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { digitsOnly, OtpInput } from './OtpInput';

afterEach(cleanup);

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <OtpInput value={v} onChange={setV} />
      <output data-testid="v">{v}</output>
    </>
  );
}
const box = (n: number) => screen.getByLabelText(`Digit ${n} of 6`) as HTMLInputElement;
const value = () => screen.getByTestId('v').textContent;

describe('OtpInput', () => {
  it('has 6 boxes and only the first asks for the one-time-code autofill', () => {
    render(<Harness />);
    expect(screen.getAllByLabelText(/Digit \d of 6/)).toHaveLength(6);
    expect(box(1).autocomplete).toBe('one-time-code');
    expect(box(2).autocomplete).toBe('off');
    expect(screen.getByRole('group', { name: 'Verification code' })).toBeTruthy();
  });

  it('typing fills a box and moves focus to the next', () => {
    render(<Harness />);
    fireEvent.change(box(1), { target: { value: '4' } });
    expect(value()).toBe('4');
    expect(document.activeElement).toBe(box(2));
    fireEvent.change(box(2), { target: { value: 'x' } }); // non-digits are ignored
    expect(value()).toBe('4');
  });

  it('a paste spreads across the boxes, ignoring spaces and extra digits', () => {
    render(<Harness />);
    fireEvent.paste(box(1), { clipboardData: { getData: () => ' 123 456 789' } });
    expect(value()).toBe('123456');
    expect(box(6).value).toBe('6');
    expect(document.activeElement).toBe(box(6));
  });

  it('autofill that drops the whole code into one box is spread too', () => {
    render(<Harness />);
    fireEvent.change(box(1), { target: { value: '654321' } });
    expect(value()).toBe('654321');
  });

  it('Backspace on an empty box clears the previous digit and steps back', () => {
    render(<Harness initial="12" />);
    box(3).focus();
    fireEvent.keyDown(box(3), { key: 'Backspace' });
    expect(value()).toBe('1');
    expect(document.activeElement).toBe(box(2));
  });

  it('shows an error under the boxes', () => {
    render(<OtpInput value="" onChange={() => {}} error="That code isn’t right." />);
    expect(screen.getByText('That code isn’t right.')).toBeTruthy();
    expect(box(1).getAttribute('aria-invalid')).toBe('true');
  });
});

it('digitsOnly keeps digits and caps the length', () => {
  expect(digitsOnly('12-34 56 78')).toBe('123456');
});
