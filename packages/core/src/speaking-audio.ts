/** Examiner lines for the non-live speaking test. Rendered offline (scripts/gen-speaking-audio.py) and keyed by the text, so the clients and the renderer must agree on every string here. */
export const SPEAKING_WELCOME = "Good morning. This is the speaking test. In this first part, I'd like to ask you some questions about yourself.";
export const SPEAKING_P2_RUBRIC =
  "Now, I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say, and you can make some notes if you wish. Here is your topic.";
export const SPEAKING_P3_LINKED = "Now, let's move on to some more general questions related to this topic.";

export type SpeakingAudioPrompt = { part: number; type: string; topic: string; title: string; body: string; followUps?: string[] | null };
/** What the examiner says for one prompt. `intro` plays only before the first segment of a full test (greeting); `lead` before the questions; `questions` aligns 1:1 with what the candidate answers. */
export function speakingLines(p: SpeakingAudioPrompt): { intro?: string; lead: string; questions: string[] } {
  const topic = `Let's talk about ${p.topic.toLowerCase()}.`;
  if (p.part === 2) return { lead: SPEAKING_P2_RUBRIC, questions: [p.title] };
  const questions = p.followUps?.length ? p.followUps : [p.body];
  if (p.part === 3) return { lead: p.type === 'p3-linked' ? SPEAKING_P3_LINKED : topic, questions };
  return { intro: SPEAKING_WELCOME, lead: topic, questions };
}
