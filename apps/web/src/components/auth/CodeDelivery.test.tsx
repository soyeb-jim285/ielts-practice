import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient, type EmailStatus } from '@/lib/auth';
import { CodeDelivery, StatusLine } from './CodeDelivery';

const base: EmailStatus = { status: 'sent', sentAt: '2026-01-01T12:01:00Z', maskedEmail: 'j•••@gmail.com', resendAvailableIn: 0, alreadySent: false, error: null };
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StatusLine', () => {
  it('sent: masked address, time and the spam hint', () => {
    render(<StatusLine s={base} />);
    expect(screen.getByRole('status').textContent).toMatch(/Code sent to j•••@gmail\.com at .*spam/);
  });
  it('already sent: age, still valid, resend countdown', () => {
    render(<StatusLine s={{ ...base, alreadySent: true, resendAvailableIn: 10 }} now={new Date('2026-01-01T12:01:20Z').getTime()} />);
    expect(screen.getByRole('status').textContent).toMatch(/already sent 20 s ago.*still valid.*resend in 10 s/);
  });
  it('failed: says so with a friendly reason, never provider text', () => {
    render(<StatusLine s={{ ...base, status: 'failed', error: 'rate_limited' }} />);
    expect(screen.getByRole('alert').textContent).toBe('We couldn’t send the email (the email service is busy). Try again.');
  });
});

describe('CodeDelivery', () => {
  it('polls the status, shows a late failure and enables Resend at once', async () => {
    vi.useFakeTimers();
    const st = vi.spyOn(authClient, 'emailStatus');
    st.mockResolvedValueOnce({ ...base, resendAvailableIn: 30 }).mockResolvedValue({ ...base, status: 'failed', sentAt: null, error: 'network' });
    render(<CodeDelivery token="t" send={async () => ({ error: null, statusToken: 't2' })} />);
    await act(async () => {});
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button').textContent).toBe('Resend code in 30s');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole('alert').textContent).toContain('couldn’t send');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
