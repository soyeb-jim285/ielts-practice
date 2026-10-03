// Validates data/cambridge-lr/C*-T*-*.json with the shared validateLrTest plus extra sanity checks.
//   pnpm tsx scripts/cambridge-lr-validate.ts [C17 ...]      (prints per-file problems; exit code 1 if any file is invalid)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLrTest, type LrTest } from '../packages/core/src/lr';

const DIR = join(import.meta.dirname, '..', 'data', 'cambridge-lr');
const only = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => /^C\d+-T\d+-(listening|reading)(-gt)?\.json$/.test(f) && (!only.length || only.some((o) => f.startsWith(o + '-')))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const wc = (s: string) => s.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).length;
const LIMIT: [RegExp, number][] = [[/ONE WORD/i, 1], [/TWO WORDS/i, 2], [/THREE WORDS/i, 3], [/FOUR WORDS/i, 4]];
const norm = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ');

let bad = 0;
for (const f of files) {
  const t: LrTest & { _problems?: string[] } = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const errs = validateLrTest(t);
  const warn: string[] = [...(t._problems ?? [])];
  for (const s of t.sections) {
    if (t.skill === 'listening') {
      const p = join(DIR, 'assets', s.audio ?? '');
      if (!s.audio || !existsSync(p)) errs.push(`part ${s.part}: audio file missing (${s.audio})`);
      else {
        const d = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString());
        if (d < 120 || d > 720) errs.push(`part ${s.part}: audio ${Math.round(d)}s outside 2-12 min`);
      }
      if (!s.transcript) warn.push(`part ${s.part}: no transcript`);
    }
    const text = norm((s.passage?.paragraphs ?? []).map((p) => p.text).join(' '));
    for (const g of s.groups) {
      if (g.image && (typeof g.image !== 'string' || !existsSync(join(DIR, 'assets', g.image)))) errs.push(`group ${g.from}: image missing (${String(g.image)})`);
      const lim = LIMIT.find(([re]) => g.wordLimit && re.test(g.wordLimit))?.[1];
      for (const q of g.questions) {
        if (g.type !== 'gap' || g.options) continue;
        for (const a of q.answer ?? []) {
          if (lim && wc(a) > lim + (/NUMBER/i.test(g.wordLimit ?? '') ? 1 : 0)) warn.push(`Q${q.n}: "${a}" exceeds ${g.wordLimit}`);
          if (t.skill === 'reading' && !q.answer!.some((x) => x.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).every((w) => text.includes(norm(w).trim())))) { warn.push(`Q${q.n}: answer "${a}" not found in passage`); break; }
        }
      }
    }
  }
  if (errs.length) bad++;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${f}${errs.length ? '\n   ' + errs.join('\n   ') : ''}${warn.length ? '\n   warn: ' + warn.join('\n   warn: ') : ''}`);
}
console.log(`${files.length - bad}/${files.length} valid`);
process.exit(bad ? 1 : 0);
