// WCAG contrast gate for the design tokens. Reads the raw hex tokens from apps/web/src/styles.css (:root and .dark)
// and checks every text/background and UI-edge pair the components use. Run: node scripts/check-contrast.mjs
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8');
const block = (sel) => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`));
  const out = {};
  for (const [, k, v] of (m?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[k] = v;
  return out;
};
const light = block(':root');
const dark = { ...light, ...block('.dark') };

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Pairs live in apps/web/src/lib/contrastPairs.json (shared with the /styleguide page): [foreground, background, minimum ratio, what it is]
export const PAIRS = JSON.parse(fs.readFileSync(new URL('../apps/web/src/lib/contrastPairs.json', import.meta.url), 'utf8'));

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let fail = 0;
  for (const [mode, t] of [['light', light], ['dark', dark]]) {
    console.log(`\n== ${mode}`);
    for (const [fg, bg, min, what] of PAIRS) {
      if (!t[fg] || !t[bg]) { console.log(`  ?? missing ${fg} or ${bg}`); fail++; continue; }
      const r = ratio(t[fg], t[bg]);
      const ok = r >= min;
      if (!ok) fail++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} (>=${min})  ${fg} on ${bg}  ${t[fg]} / ${t[bg]}  ${what}`);
    }
  }
  console.log(fail ? `\n${fail} failing pairs` : '\nall pairs pass');
  process.exit(fail ? 1 : 0);
}
