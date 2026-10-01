import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { digitsOnly, OtpInput } from './OtpInput';

afterEach(cleanup);

function Harness({ initial = '', error }: { initial?: string; error?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <OtpInput value={v} onChange={setV} error={error} />
      <output data-testid="v">{v}</output>
    </>
  );
}
const input = () => screen.getByLabelText('Verification code') as HTMLInputElement;
const value = () => screen.getByTestId('v').textContent;
const slots = () => document.querySelectorAll('[data-slot="input-otp-slot"]');

describe('OtpInput (shadcn InputOTP)', () => {
  it('renders 6 boxes over one input that asks for the one-time-code autofill', () => {
    render(<Harness />);
    expect(slots()).toHaveLength(6);
    expect(input().autocomplete).toBe('one-time-code');
    expect(input().inputMode).toBe('numeric');
  });

  it('typing fills the boxes in order, digits only', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '12' } });
    expect(value()).toBe('12');
    expect(slots()[0]?.textContent).toBe('1');
    expect(slots()[1]?.textContent).toBe('2');
    fireEvent.change(input(), { target: { value: '12x' } }); // rejected by the digits pattern
    expect(value()).toBe('12');
  });

  it('a full code (autofill) fills all six boxes', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '654321' } });
    expect(value()).toBe('654321');
    expect(slots()[5]?.textContent).toBe('1');
  });

  it('shows an error under the boxes and marks the input invalid', () => {
    render(<Harness error="That code is wrong or expired." />);
    expect(screen.getByText('That code is wrong or expired.')).toBeTruthy();
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('digitsOnly strips spaces and extra digits', () => {
    expect(digitsOnly(' 123 456 789')).toBe('123456');
  });
});
