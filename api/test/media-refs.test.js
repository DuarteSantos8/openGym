/* referencedHashes() decides which stored files the server keeps. The app has its own copy
   (frontend/src/lib/media-refs.js) deciding which local files the device keeps, and the two must
   never disagree: a hash the server counts and the device does not is a file one side deletes
   while the other still shows it. Both are tested against this one fixture. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencedHashes } from '../media.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'media-refs.json');
const { referencedHashes: cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('the shared fixture is there and has cases', () => {
  assert.ok(Array.isArray(cases) && cases.length >= 10);
});

for (const c of cases) {
  test(`referencedHashes: ${c.name}`, () => {
    const got = referencedHashes(c.state);
    assert.ok(got instanceof Set);
    assert.deepEqual([...got].sort(), [...c.expect].sort());
  });
}

test('never throws, whatever the state is', () => {
  for (const S of [undefined, 0, '', 'x', [], [1], { customEx: null }, { customEx: [{ media: null }] }, { customEx: [{ media: { poster: 'x' } }] }]) {
    assert.deepEqual([...referencedHashes(S)], []);
  }
});
