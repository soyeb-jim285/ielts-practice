import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_LIVEKIT } from '@ielts/core';
import { LiveKitSettings } from './LiveKitSettings';
afterEach(cleanup);

it('copies the full effective configuration when editing a part provider', () => {
  const set = vi.fn();
  render(<LiveKitSettings cfg={DEFAULT_LIVEKIT} set={set} disabled={false} />);
  fireEvent.change(screen.getByLabelText('Configuration profile'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Transcription provider / model'), { target: { value: 'elevenlabs' } });
  expect(set).toHaveBeenCalledWith({ ...DEFAULT_LIVEKIT, parts: { '2': { ...DEFAULT_LIVEKIT, stt: 'elevenlabs', sttModel: 'scribe_v2_realtime' } } });
});
it('disables every configuration control during a run', () => {
  render(<LiveKitSettings cfg={DEFAULT_LIVEKIT} set={vi.fn()} disabled />);
  for (const input of screen.getAllByRole('combobox')) expect((input as HTMLSelectElement).disabled).toBe(true);
  for (const input of screen.getAllByRole('spinbutton')) expect((input as HTMLInputElement).disabled).toBe(true);
});
