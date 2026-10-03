// Prints every distinct examiner line for the generated speaking bank as JSON [{hash,text}] (input of scripts/gen-speaking-audio.py).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { speakingLines } from '../packages/core/src/speaking-audio';
import { BANK_KINDS } from '../apps/server/src/seed';
import { speakingAudioHash } from '../apps/server/src/ai/speaking-audio';

const dir = fileURLToPath(new URL('../data/bank/', import.meta.url));
const texts = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.startsWith('speaking-') && x.endsWith('.json'))) {
  const kind = BANK_KINDS.find((k) => f.startsWith(k.prefix))!;
  for (const raw of JSON.parse(readFileSync(dir + f, 'utf8'))) {
    const r = kind.schema.safeParse(raw);
    if (!r.success) continue;
    for (const row of kind.rows(r.data)) {
      const l = speakingLines({ part: row.part, type: row.type, topic: row.topic, title: row.title, body: row.body, followUps: row.followUps });
      [l.intro, l.lead, ...l.questions].forEach((t) => t && texts.add(t));
    }
  }
}
console.log(JSON.stringify([...texts].sort().map((text) => ({ hash: speakingAudioHash(text), text }))));
