#!/usr/bin/env node
/* Generates api/coach/library.json from the frontend's exercise dataset.
 *
 *   node scripts/build-coach-library.mjs           # write
 *   node scripts/build-coach-library.mjs --check   # fail if stale (CI)
 *
 * The API needs the catalogue for two things the client cannot do for it: validating that
 * every exercise id a proposal references actually exists (FR-16), and building payloads for
 * scheduled reviews, which run with nobody's browser open. Rather than teach the api build to
 * reach into frontend/, the index is generated and committed — the same arrangement the
 * translated instruction packs in src/instr/ already use.
 *
 * Only the fields the Coach reasons over are kept: an id, a name, and the three taxonomy
 * fields it filters on. Instructions, images and secondary muscles stay out — they would
 * quadruple a payload the model has no use for.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'frontend', 'src', 'lib', 'exercises-data.js');
const extra = join(root, 'frontend', 'src', 'lib', 'exercises-extra.js');
const out = join(root, 'api', 'coach', 'library.json');

/* Mirrors the merge exercises.js performs. Imported separately rather than through exercises.js
   because that module pulls in i18n and the browser-side helpers, which this script has no use
   for and cannot load. If the merge changes shape, both sides change together. */
const { EXDB } = await import(pathToFileURL(src).href);
const { EXTRA } = await import(pathToFileURL(extra).href);
const index = [...EXDB, ...EXTRA].map(e => ({ id: e.id, n: e.n, bp: e.bp, tg: e.tg, eq: e.eq }));
const json = JSON.stringify({ generated_from: 'frontend/src/lib/exercises-data.js + exercises-extra.js', count: index.length, exercises: index }) + '\n';

if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(out, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== json) {
    console.error('api/coach/library.json is out of date — run: node scripts/build-coach-library.mjs');
    process.exit(1);
  }
  console.log(`api/coach/library.json in sync (${index.length} exercises).`);
} else {
  writeFileSync(out, json);
  console.log(`Wrote ${out} — ${index.length} exercises, ${(json.length / 1024).toFixed(0)} KB.`);
}
