// nudge-copy.js is generated from the frontend's English pool and locale packs (the api image has
// no frontend to read them from at runtime). A string changed on one side only fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('api/nudge-copy.js matches the frontend strings (node scripts/build-nudge-copy.mjs)', async t => {
  if (!fs.existsSync(path.join(API, '..', 'frontend', 'src', 'lib', 'nudge.js'))) return t.skip('no frontend next to the api');
  const { buildNudgeCopy } = await import('../scripts/build-nudge-copy.mjs');
  assert.equal(fs.readFileSync(path.join(API, 'nudge-copy.js'), 'utf8'), await buildNudgeCopy(),
    'api/nudge-copy.js is out of date: run node scripts/build-nudge-copy.mjs in api/');
});
