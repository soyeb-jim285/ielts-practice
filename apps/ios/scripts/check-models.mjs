// Drift check for the hand-written Codable models (instead of swift-openapi-generator; see the spec's "As shipped").
// Every struct in Models.swift tagged `// openapi: Schema[.prop|[]]...` must only use keys the schema has, and its
// non-optional keys must be required and non-null there. Reads apps/web/src/openapi.json, which CI keeps fresh.
// Usage: node apps/ios/scripts/check-models.mjs [Models.swift] [openapi.json]
import { readFileSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const swift = readFileSync(process.argv[2] ?? here('../IELTS/Core/Models.swift'), 'utf8');
const spec = JSON.parse(readFileSync(process.argv[3] ?? here('../../web/src/openapi.json'), 'utf8'));

/** Resolves $ref and merges allOf into one {properties, required}. */
function resolve(s) {
  if (s?.$ref) return resolve(spec.components.schemas[s.$ref.split('/').pop()]);
  if (s?.allOf) {
    const parts = s.allOf.map(resolve);
    return { ...s, properties: Object.assign({}, ...parts.map((p) => p.properties)), required: parts.flatMap((p) => p.required ?? []) };
  }
  return s ?? {};
}

function schemaAt(path) {
  const [root, ...rest] = path.split(/\.|(?=\[\])/);
  let s = spec.components.schemas[root];
  for (const seg of rest) s = s && (seg === '[]' ? resolve(s).items : resolve(s).properties?.[seg]);
  return s && resolve(s);
}

const nullable = (p) => [p?.type].flat().includes('null') || p?.nullable === true;

/** Stored properties at the top level of a struct body (nested types, computed vars and inits removed). */
function storedProps(body) {
  let flat = '', depth = 0;
  for (const ch of body.replace(/\/\/.*$/gm, '')) {
    if (ch === '{') depth++;
    if (depth === 0) flat += ch;
    if (ch === '}') { depth--; if (depth === 0) flat += '{}'; }
  }
  const props = [];
  for (const m of flat.matchAll(/(?<!static\s+)\b(?:let|var)\s+([^;\n={]+)(\{\})?/g)) {
    if (m[2]) continue; // computed property
    let bracket = 0, cur = '';
    const decls = [];
    for (const ch of m[1]) {
      if ('[<('.includes(ch)) bracket++;
      if (']>)'.includes(ch)) bracket--;
      if (ch === ',' && bracket === 0) { decls.push(cur); cur = ''; } else cur += ch;
    }
    decls.push(cur);
    for (const d of decls) {
      const [, name, type] = d.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/) ?? [];
      if (name) props.push({ name, optional: type.endsWith('?') });
    }
  }
  return props;
}

const errors = [];
let checked = 0;
for (const m of swift.matchAll(/\/\/ openapi: (\S+)\s*\n\s*struct (\w+)[^{]*\{/g)) {
  const [, path, name] = m;
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  for (; depth > 0; i++) depth += swift[i] === '{' ? 1 : swift[i] === '}' ? -1 : 0;
  const schema = schemaAt(path);
  if (!schema?.properties) { errors.push(`${name}: no object schema at ${path}`); continue; }
  checked++;
  const required = new Set(schema.required ?? []);
  for (const p of storedProps(swift.slice(start, i - 1))) {
    const sp = schema.properties[p.name];
    if (!sp) errors.push(`${name}.${p.name}: not in ${path}`);
    else if (!p.optional && (!required.has(p.name) || nullable(sp))) errors.push(`${name}.${p.name}: non-optional in Swift but optional/nullable in ${path}`);
  }
}

// Disfluency.kinds must list exactly core's DisfluencyKind union (the server returns every one of them).
const coreKinds = readFileSync(here('../../../packages/core/src/speech.ts'), 'utf8').match(/type DisfluencyKind = ([^;]+);/)?.[1].match(/'(\w+)'/g)?.map((k) => k.slice(1, -1));
const swiftKinds = [...(swift.match(/static let kinds[\s\S]*?\n    \]/)?.[0] ?? '').matchAll(/Kind\(key: "(\w+)"/g)].map((m) => m[1]);
if (!coreKinds || coreKinds.join() !== swiftKinds.join()) errors.push(`Disfluency.kinds [${swiftKinds}] != core DisfluencyKind [${coreKinds}]`);

if (checked === 0) errors.push('no `// openapi:` tagged structs found');
if (errors.length) {
  console.error(`Models.swift drifted from openapi.json:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`Models.swift: ${checked} structs match openapi.json`);
