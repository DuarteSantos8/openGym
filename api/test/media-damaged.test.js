/* A stored upload that is not whole — an empty or truncated file left by a host reset right after
   the upload (the blob is renamed to a new name, which ext4's rename heuristic does not cover), or
   by a damaged restore — used to be vouched for forever: /api/media/missing said "not missing",
   GET served 0 bytes, and a re-upload of the good bytes answered "existed" and kept the damage.
   Once the original phone was gone, so was the photo. (QA 2026-10-06.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMediaStore, mediaLimits } from '../media.js';
import * as M from './media-samples.mjs';

const quiet = { warn() {}, error() {}, log() {} };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-dmg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'uploads');
  const make = () => createMediaStore({ dir, limits: { ...mediaLimits({}), minFreeMB: 0 }, log: quiet });
  return { dir, make };
}

for (const damage of ['empty', 'truncated']) {
  test(`a ${damage} stored file is missing, not served, and replaced by the next upload`, async t => {
    const h = setup(t);
    const bytes = M.png(4000), hash = M.sha(bytes);
    let store = h.make();
    assert.equal((await store.receive('u1', hash, M.fakeReq(bytes, { declare: 'image/png' }))).status, 201);
    const file = path.join(h.dir, 'u1', `${hash}.png`);
    fs.truncateSync(file, damage === 'empty' ? 0 : 1000);
    store = h.make();   // the server starts again after the reset
    // an empty file is missing; a truncated one is only found out when its bytes come again
    if (damage === 'empty') {
      assert.deepEqual(store.missing('u1', [hash]).missing, [hash]);
      assert.equal(store.file('u1', hash), null);
    }
    const r = await store.receive('u1', hash, M.fakeReq(bytes, { declare: 'image/png' }));
    assert.equal(r.status, 201);
    assert.equal(fs.statSync(file).size, 4000);
    assert.deepEqual(store.missing('u1', [hash]).missing, []);
    assert.equal(store.usage('u1').bytes, 4000);
    assert.equal(store.usage('u1').count, 1);
  });
}

test('a whole stored file is still taken as it is', async t => {
  const h = setup(t);
  const bytes = M.png(4000), hash = M.sha(bytes);
  const store = h.make();
  assert.equal((await store.receive('u1', hash, M.fakeReq(bytes, { declare: 'image/png' }))).status, 201);
  const again = await store.receive('u1', hash, M.fakeReq(bytes, { declare: 'image/png' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.existed, true);
});
