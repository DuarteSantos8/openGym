// trainers/push-copy.js is generated from frontend/src/lib/trainer-notices.js and the locale packs
// (the api image has no frontend). A string changed on one side only fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('api/trainers/push-copy.js matches the frontend strings (node scripts/build-trainer-copy.mjs)', async t => {
  if (!fs.existsSync(path.join(API, '..', 'frontend', 'src', 'lib', 'trainer-notices.js'))) return t.skip('no frontend next to the api');
  const { buildTrainerCopy } = await import('../scripts/build-trainer-copy.mjs');
  assert.equal(fs.readFileSync(path.join(API, 'trainers', 'push-copy.js'), 'utf8'), await buildTrainerCopy(),
    'api/trainers/push-copy.js is out of date: run node scripts/build-trainer-copy.mjs in api/');
});
