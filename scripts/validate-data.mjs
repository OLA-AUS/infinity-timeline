#!/usr/bin/env node
// Validate every JSON file in data/. Run before opening a pull request:
//
//   npm run validate:data
//
// CI runs this on every pull request. On GitHub, problems show up as red notes
// right on the changed lines of the pull request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEntity, checkEvent, checkReferences, checkSource } from './lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const inCI = !!process.env.GITHUB_ACTIONS;

/** Every .json file under a folder (recursively). */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : d.name.endsWith('.json') ? [p] : [];
  });
}

const KINDS = [
  { kind: 'event', dir: 'events', check: checkEvent },
  { kind: 'entity', dir: 'entities', check: checkEntity },
  { kind: 'source', dir: 'sources', check: checkSource },
];

const problems = [];
const files = [];
for (const { kind, dir, check } of KINDS) {
  for (const abs of walk(path.join(DATA, dir))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      problems.push({ path: rel, message: `not valid JSON: ${e.message}` });
      continue;
    }
    files.push({ path: rel, kind, data });
    for (const message of check(data, path.basename(abs, '.json'))) problems.push({ path: rel, message });
  }
}
problems.push(...checkReferences(files));

for (const p of problems) {
  if (inCI) console.log(`::error file=${p.path}::${p.message}`);
  console.log(`✗ ${p.path}: ${p.message}`);
}
const counts = KINDS.map(({ kind }) => `${files.filter((f) => f.kind === kind).length} ${kind}${kind === 'entity' ? ' files' : 's'}`).join(', ');
if (problems.length) {
  console.log(`\n${problems.length} problem(s) in data/ (${counts}).`);
  process.exit(1);
}
console.log(`✓ data/ is valid (${counts}).`);
