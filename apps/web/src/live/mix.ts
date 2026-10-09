// The whole conversation for playback: the candidate's mic mixed with the examiner's voice, recorded continuously (the scoring recording
// pauses over the examiner instead). Best effort: null when there is nothing live to record or the browser can't.
import { pickMime } from '@/hooks/useRecorder';

export type MixRecording = { stop(): Promise<{ blob: Blob; mime: string } | null> };

export function recordMix(streams: (MediaStream | null | undefined)[]): MixRecording | null {
  const live = streams.filter((s): s is MediaStream => !!s && s.getAudioTracks().some((t) => t.readyState === 'live'));
  if (!live.length || !globalThis.MediaRecorder || !globalThis.AudioContext) return null;
  try {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const s of live) ctx.createMediaStreamSource(s).connect(dest);
    const mime = pickMime();
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => void (e.data.size && chunks.push(e.data));
    rec.start(1000);
    return {
      stop: () =>
        new Promise((resolve) => {
          rec.onstop = () => {
            void ctx.close().catch(() => {});
            const type = rec.mimeType || mime || 'audio/webm';
            resolve(chunks.length ? { blob: new Blob(chunks, { type }), mime: type } : null);
          };
          try {
            rec.stop();
          } catch {
            resolve(null);
          }
        }),
    };
  } catch {
    return null;
  }
}
