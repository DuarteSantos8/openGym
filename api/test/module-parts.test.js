// The parts of a module (frontend lib/modules.js PARTS, #1087) are 'module.part' keys in
// S.modules: the server stamps each on its own like a module, and the Your year part pauses the push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';
import { wrappedSummary } from '../wrapped.js';

test('the API stamps each part on its own, beside the modules', () => {
  const before = { _ts: 10, modules: { body: true, 'body.photos': true }, edited: { 'modules.body': 10, 'modules.body.photos': 10 } };
  const after = structuredClone(before);
  after.modules['body.photos'] = false;
  after.modules['motivation.share'] = false;
  stampPut(before, after, { overRead: true, now: 100 });
  assert.equal(after.edited['modules.body.photos'], 100);
  assert.equal(after.edited['modules.motivation.share'], 100);
  assert.equal(after.edited['modules.body'], 10);
  assert.deepEqual(after.modules, { body: true, 'body.photos': false, 'motivation.share': false });
});

test('Your year off is the December push off too, the module on or not', () => {
  assert.equal(wrappedSummary({ modules: { 'motivation.year': false } }).notify, false);
  assert.equal(wrappedSummary({ modules: { motivation: true, 'motivation.year': false } }).notify, false);
  assert.equal(wrappedSummary({ modules: { 'motivation.year': true } }).notify, true);
  assert.equal(wrappedSummary({ modules: { 'motivation.share': false } }).notify, true);
});
