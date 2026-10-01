// GPT-Live wire format (developers.openai.com/api/docs/guides/live-conversations): events on the "oai-events" data channel, parsed into the few the examiner needs.
// Full duplex: there is no turn control (no commit, no response.create, no response.done), so "answered" and "speaking" are inferred from the caption deltas.

export type LiveEvent =
  | { type: 'started' }
  | { type: 'inText'; text: string }
  | { type: 'outText'; text: string }
  | { type: 'closed'; reason: string }
  | { type: 'error'; message: string };

type Raw = { type?: string; delta?: string; reason?: string; error?: { message?: string } };

/** One data channel message → an event (null: nothing we act on, e.g. usage updates). Deltas are appended verbatim. */
export function parseLiveEvent(data: string): LiveEvent | null {
  let m: Raw;
  try {
    m = JSON.parse(data) as Raw;
  } catch {
    return null;
  }
  switch (m.type) {
    case 'session.started':
      return { type: 'started' };
    case 'session.input_transcript.delta':
      return typeof m.delta === 'string' ? { type: 'inText', text: m.delta } : null;
    case 'session.output_transcript.delta':
      return typeof m.delta === 'string' ? { type: 'outText', text: m.delta } : null;
    case 'session.closed':
      return { type: 'closed', reason: m.reason ?? '' };
    case 'error':
      return { type: 'error', message: m.error?.message ?? '' };
    default:
      return null;
  }
}

export const muteEvent = (on: boolean, id: string = crypto.randomUUID()) => ({ type: on ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: id });
export const closeEvent = () => ({ type: 'session.close', event_id: 'close' });
/** What the client appends itself, only when the server could not send a cue through its sideband. */
export const appendEvent = (content: string, id: string = crypto.randomUUID()) => ({ type: 'session.instructions.append', event_id: id, delegation_id: null, content });
