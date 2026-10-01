// Calibration-only low-end scripts (authored, nominal band 3.5-4). The gold calibration pool has almost nothing below band 4.5, so the fitted map could not
// reach the floor (raw 4.5 mapped to 4.5). Authored here, like the probe floors, but in the CALIBRATION split and never in test or probe runs.
// Labels are nominal: written to the descriptors (errors predominate, meaning often unclear, tiny range, weak paragraphing), not examiner marks.
// Each reuses a calibration prompt (same groupId), so grouped CV keeps it with that prompt's real script.
//   pnpm -F @ielts/server exec tsx --env-file-if-exists=../../.env ../../scripts/gold-calib-floor.ts
import { createHash } from 'node:crypto';
import { db, sql } from '../apps/server/src/db/client';
import { scoringScripts } from '../apps/server/src/db/schema';

const T: { id: string; from: string; band: number; text: string }[] = [
  { id: 'calibx-floor-1', from: 'cam-16-1-w2', band: 3.5, text: `History house is important. I am think house have history. People want know the history because they is curious. The house is old and the people is old. Some people he like the old house and some people not like.

The reason one is the people want to know about family. My family have house old. My grandfather build the house in the village. I am not see the my grandfather but my father tell me. The house have big tree and the water. I like the house very much and I want know more.

The reason two is the money. House old is many money. If the people know the history they sell it. Not know the history the price is low. Many people is buy the house old and sell it. This is business.

How people find the history. They can ask the people. They can see the internet or the book. The book have history of house. Or they can go to the place where the paper is. The people there is tell them. Some time the paper is lost, it is problem, the people cannot find. Then they must asking the old man.

Is good to know the history of house because the house is our life. We live in the house and we eat in the house. So the house is very important. I think the people must know the history house. This is my opinion.` },
  { id: 'calibx-floor-2', from: 'cam-17-4-w2', band: 3.5, text: `Today many people go alternative medicine. Alternative medicine is not the doctor. I think it is bad. I tell why.

Doctor is go university long time. He is know the body and the sick. The alternative man he is not go university. He is only know the plant and the oil. The plant is not medicine. My uncle he is use the plant for back pain. The pain is not go, is more big. Then he go the doctor and the doctor is angry.

Another thing is the price. People say alternative is cheap but is not true. The oil is expensive and the man want many money every time he come. The doctor in hospital is free in my country so is better go there.

Some people say the alternative is nature and nature is good. I am not agree. The nature is have danger. The snake is nature and the fire is nature. Is not good for all the thing.

Also the alternative not have machine. How he see inside the body. He cannot see so he not know what is the sick. He only guess and guess is wrong some time.

So I think people must go doctor and not go alternative man. The government must tell the people this. It is danger thing for the health.` },
  { id: 'calibx-floor-3', from: 'cam-15g-3-w2', band: 3, text: `Many people in the future go holiday in they country. I am agree. Is because of many reason.

First is the money. Abroad is money much. Plane ticket is money, the hotel is money, the food is money. In my country is not much money. I go with car of my friend and we sleep in the tent. Is good holiday and cheap.

Second is the language. When I go abroad I not speak the language. I can not say the thing. One time my brother he go to France and he is hungry but he not can say the food so he not eat one day. This is bad. In my country I speak all people and I am not problem.

Third is my country have beautiful. Have sea, have mountain, have river. The tourist from other country is come to see. So why I go other country. I see my country first.

Also the abroad is the tired. The plane is long and the ear is pain. I not like the plane. The people is stay in the airport and wait and wait.

So I am agree more people is stay in own country. Is better for money and for language and for the ear. This is all.` },
  { id: 'calibx-floor-4', from: 'cam-16-1-w1', band: 3.5, text: `The chart is about the electrical and housework in one country in 1920 to 2019.

First chart. The washing machine is 40 in 1920 and is more in 2019. The refrigerator is low and is high. The vacuum is low and is high also. Is all go up. The people is have the machine more.

Second chart. The housework is hours. In 1920 is 50 hours the woman and 5 the man. After is less the woman and more a little the man. In 2019 the woman is 20 and the man is 10.

I think is because the machine. The machine is good for the people and the woman is not work so much. The man is help the woman now. Before the man is not help.

The chart is show many thing. The electrical is go up and the housework is go down. This is the chart information.` },
  { id: 'calibx-floor-5', from: 'cam-18-1-w1', band: 3.5, text: `The graph is show the city people in four country Asian. Is from 1970 and to 2040.

Malaysia is up, is top. Is 27 and then is 77 in 2020. Indonesia is low and up to 70 in 2040. Philippines is not change is like 30 and 50. Thailand is low in the start and up slow.

Is many people go the city because the work. In the city is have job and the school and the hospital. The village is not have. So the people is go and the city is big. In future the city is more big and the village is more small.

The graph is tell us the people like the city. All the country is the same, is go up. This is the graph.` },
  { id: 'calibx-floor-6', from: 'cam-15g-2-w1', band: 3.5, text: `Dear sir

I am write you for the museum. I am see the paper you want people work. I want work in the museum.

I like museum. I am go the museum many time. Is interesting the old thing, the picture and the statue. I am student and I have time. Is not money I not want money, I want learn.

I have good skill. I speak English and I speak Chinese. The tourist is come and I can talk. I am friendly and I am not late. I work in shop before is one year.

I can come Saturday and Sunday. I can start the next month. You can call me and I come the interview.

Thank you very much. I wait your letter.

Jim` },
];

const all = await db.select().from(scoringScripts);
for (const t of T) {
  const src = all.find((r) => r.id === t.from);
  if (!src || src.role !== 'calib') throw new Error(`${t.from} is not a calibration script`);
  const row = {
    id: t.id, skill: 'writing' as const, taskFamily: src.taskFamily, role: 'calib', split: 'calibration', band: t.band, groupId: src.groupId, prompt: src.prompt, text: t.text,
    note: 'Authored low-end script (nominal band): calibration floor, never scored in test or probe runs.', expect: { authored: true }, source: 'authored (calibration floor)',
    sha256: createHash('sha256').update(t.text).digest('hex'),
  };
  await db.insert(scoringScripts).values(row).onConflictDoUpdate({ target: scoringScripts.id, set: { ...row, updatedAt: new Date() } });
  console.log(t.id, src.taskFamily, t.text.split(/\s+/).length, 'words');
}
await sql.end();
