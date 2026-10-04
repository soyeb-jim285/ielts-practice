// Renders the brand images into apps/web/public: link-preview cards (og/*.png, 1200x630), app icons and favicon.ico.
// Uses the site's own fonts (Newsreader, Hanken Grotesk) and palette. Run: node scripts/gen-brand-assets.mjs (needs @playwright/test's Chromium).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(root + 'apps/web/package.json');
const { chromium } = require('@playwright/test');
const out = root + 'apps/web/public/';
mkdirSync(out + 'og', { recursive: true });

const font = (pkg, file) => readFileSync(`${root}apps/web/node_modules/@fontsource-variable/${pkg}/files/${file}`).toString('base64');
const CSS = `
@font-face { font-family: Newsreader; src: url(data:font/woff2;base64,${font('newsreader', 'newsreader-latin-opsz-normal.woff2')}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: Hanken; src: url(data:font/woff2;base64,${font('hanken-grotesk', 'hanken-grotesk-latin-wght-normal.woff2')}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg: #0a111c; --panel: #111b2b; --line: #22324a; --ink: #eef3f8; --muted: #93a4ba; --teal: #2dd4bf; --teal-deep: #0f766e; --warn: #fbbf24; --bad: #f87171; }
body { width: 1200px; height: 630px; background: var(--bg); color: var(--ink); font-family: Hanken, sans-serif; overflow: hidden; position: relative; }
.glow { position: absolute; inset: 0; background: radial-gradient(900px 500px at 105% -10%, rgba(45,212,191,.20), transparent 60%), radial-gradient(700px 420px at -10% 120%, rgba(15,118,110,.25), transparent 60%); }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 40px 40px; mask-image: linear-gradient(90deg, transparent, #000 55%); }
.wrap { position: absolute; inset: 60px 72px 56px; display: flex; gap: 52px; }
.left { flex: 1.2; display: flex; flex-direction: column; justify-content: space-between; }
.mid { display: flex; flex-direction: column; }
.right { flex: 1; display: flex; align-items: center; justify-content: center; }
.brand { display: flex; align-items: center; gap: 16px; font-family: Newsreader; font-size: 34px; font-weight: 500; letter-spacing: -.01em; }
.mark { width: 52px; height: 52px; border-radius: 12px; background: var(--teal); color: #042f2c; display: grid; place-items: center; font-family: Newsreader; font-size: 40px; font-weight: 500; line-height: 1; padding-top: 2px; }
.kicker { color: var(--teal); font-size: 22px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin-top: 12px; font-family: Newsreader; font-weight: 500; font-size: 58px; line-height: 1.04; letter-spacing: -.02em; }
p.sub { margin-top: 18px; color: var(--muted); font-size: 23px; line-height: 1.4; max-width: 580px; }
.foot { display: flex; gap: 10px; flex-wrap: nowrap; }
.chip { border: 1px solid var(--line); background: rgba(17,27,43,.8); border-radius: 999px; padding: 7px 15px; font-size: 18px; white-space: nowrap; color: var(--ink); }
.url { position: absolute; right: 72px; bottom: 60px; color: var(--muted); font-size: 20px; letter-spacing: .02em; }
.card { width: 100%; background: linear-gradient(180deg, #132036, #0f1a2b); border: 1px solid var(--line); border-radius: 24px; padding: 30px; box-shadow: 0 30px 80px rgba(0,0,0,.45); }
.label { color: var(--muted); font-size: 17px; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; }
.band { font-family: Newsreader; font-size: 112px; font-weight: 500; line-height: 1; color: var(--teal); margin: 8px 0 18px; }
.bar { display: grid; grid-template-columns: 170px 1fr 44px; align-items: center; gap: 14px; font-size: 19px; margin-top: 12px; color: var(--ink); }
.track { height: 10px; border-radius: 6px; background: #1d2b42; overflow: hidden; } .fill { height: 100%; border-radius: 6px; background: var(--teal); }
.n { text-align: right; font-weight: 600; }
.t { font-family: Newsreader; font-size: 27px; line-height: 1.75; }
.pause { display: inline-block; font-family: Hanken; font-size: 17px; background: rgba(248,113,113,.15); color: var(--bad); border-radius: 8px; padding: 2px 10px; vertical-align: 4px; }
.err { text-decoration: underline wavy var(--bad) 2px; text-underline-offset: 6px; }
.fix { color: var(--teal); font-family: Hanken; font-size: 19px; }
.mark-hl { background: rgba(45,212,191,.22); border-radius: 6px; padding: 0 4px; }
.wave { display: flex; align-items: center; gap: 5px; height: 90px; margin: 14px 0 6px; }
.wave i { display: block; width: 7px; border-radius: 4px; background: var(--teal); opacity: .9; }
.row { display: flex; align-items: center; gap: 14px; padding: 11px 0; border-top: 1px solid var(--line); font-size: 21px; }
.q { width: 38px; height: 34px; border-radius: 8px; background: #1d2b42; display: grid; place-items: center; font-weight: 600; font-size: 18px; }
.ok { color: var(--teal); font-weight: 700; } .no { color: var(--bad); font-weight: 700; }
`;

const shell = (kicker, title, sub, chips, visual) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="glow"></div><div class="grid"></div>
<div class="wrap"><div class="left">
  <div class="brand"><div class="mark">I</div>IELTS Practice</div>
  <div class="mid"><div class="kicker">${kicker}</div><h1>${title}</h1><p class="sub">${sub}</p></div>
  <div class="foot">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
</div><div class="right">${visual}</div></div>
<div class="url">ielts.soyebjim.me</div></body></html>`;

const bars = (rows) => rows.map(([k, v]) => `<div class="bar"><span>${k}</span><span class="track"><span class="fill" style="display:block;width:${(v / 9) * 100}%"></span></span><span class="n">${v}</span></div>`).join('');
const wave = Array.from({ length: 38 }, (_, i) => `<i style="height:${18 + Math.round(70 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)))}px;${i > 15 && i < 20 ? 'opacity:.25' : ''}"></i>`).join('');

const CARDS = {
  home: shell('Free IELTS practice', 'All four skills.<br>An honest band score.', 'Real-format tests for Speaking, Writing, Listening and Reading, marked against the official band descriptors.', ['Speaking', 'Writing', 'Listening', 'Reading'],
    `<div class="card"><div class="label">Overall band</div><div class="band">7.5</div>${bars([['Fluency', 7], ['Vocabulary', 8], ['Grammar', 7], ['Pronunciation', 7.5]])}</div>`),
  speaking: shell('IELTS Speaking', 'Talk to an examiner.<br>See every pause.', 'Parts 1, 2 and 3 read aloud, or a live AI examiner. A band for each criterion and your transcript, marked.', ['Parts 1 · 2 · 3', 'Live examiner', 'Band scores'],
    `<div class="card"><div class="label">Your answer</div><div class="wave">${wave}</div><div class="t">I grew up in a small town <span class="pause">pause 1.2s</span> near the coast, and I <span class="err">has lived</span> there…</div><div class="fix">→ have lived</div></div>`),
  writing: shell('IELTS Writing', 'Task 1 and Task 2, marked line by line.', 'Academic and General Training under exam timing. Every error explained, and your essay rewritten one band higher.', ['Task 1', 'Task 2', 'Academic & GT'],
    `<div class="card"><div class="label">Task 2 · Band 6.5 → 7.5</div><div class="t" style="margin-top:12px">Some people believe that <span class="err">technology have</span> made our lives more complicated. <span class="mark-hl">In my view</span>, the benefits clearly outweigh…</div><div class="fix" style="margin-top:10px">→ technology has · subject–verb agreement</div></div>`),
  listening: shell('IELTS Listening', 'Full tests with real exam timing.', 'All four parts, or one at a time. Your score, the band, and the exact moment each answer is spoken.', ['40 questions', 'Instant band', 'Transcript'],
    `<div class="card"><div class="label">Part 1 · 0:42 / 6:10</div><div class="wave" style="height:60px">${wave}</div>${[[1, 'Whitcombe', 1], [2, '27 Orchard Road', 1], [3, 'Thursday', 0], [4, 'nurse', 1]].map(([n, a, ok]) => `<div class="row"><span class="q">${n}</span><span style="flex:1">${a}</span><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span></div>`).join('')}</div>`),
  reading: shell('IELTS Reading', 'Every passage.<br>Every answer located.', 'Full tests or one passage at a time. Instant band, where each answer is in the text, and True / False / Not Given explained.', ['3 passages', 'Answer locations', 'T / F / NG'],
    `<div class="card"><div class="label">Passage 2 · Question 17</div><div class="t" style="margin-top:12px;font-size:24px;line-height:1.7">The canal was finally completed in 1822, <span class="mark-hl">almost a decade later than its engineers had planned</span>, after funds ran short…</div><div class="row" style="margin-top:14px"><span class="q">17</span><span style="flex:1">Building finished on schedule.</span><span class="no">FALSE</span></div></div>`),
};

// Icons: the logo mark (serif "I" on a teal tile). `pad` keeps the maskable icon inside its safe zone.
const icon = (size, { radius = 0.22, pad = 0, bg = '#2dd4bf' } = {}) => `<!doctype html><html><head><style>${CSS}
body{width:${size}px;height:${size}px;background:${pad ? bg : 'transparent'};display:grid;place-items:center}
.m{width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px;border-radius:${radius * 100}%;background:${bg};color:#042f2c;display:grid;place-items:center;font-family:Newsreader;font-weight:500;font-size:${size * (1 - pad * 2) * 0.78}px;line-height:1;padding-top:${size * 0.04}px}
</style></head><body><div class="m">I</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (html, w, h, file, transparent = false) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png', omitBackground: transparent });
  if (file) writeFileSync(out + file, buf);
  return buf;
};
for (const [name, html] of Object.entries(CARDS)) await shot(html, 1200, 630, `og/${name}.png`);
await shot(icon(180, { radius: 0 }), 180, 180, 'apple-touch-icon.png'); // iOS rounds the corners itself
await shot(icon(192), 192, 192, 'icon-192.png', true);
await shot(icon(512), 512, 512, 'icon-512.png', true);
await shot(icon(512, { radius: 0, pad: 0.12 }), 512, 512, 'icon-maskable-512.png');
// favicon.ico = one 32x32 PNG in an ICO container (every browser accepts PNG-in-ICO).
const png = await shot(icon(32, { radius: 0.2 }), 32, 32, null, true);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); // type icon, 1 image
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(out + 'favicon.ico', Buffer.concat([ico, png]));
await browser.close();
console.log('wrote og/{home,speaking,writing,listening,reading}.png, icons, favicon.ico');
