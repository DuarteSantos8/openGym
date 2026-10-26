import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

test('the API stamps built-in aliases independently per exercise, including a clear', () => {
  const before = { _ts: 10, exAliases: { a: ['Old'], b: ['Row'] }, edited: { 'exAliases.a': 10, 'exAliases.b': 10 } };
  const after = structuredClone(before);
  after.exAliases.a = [];
  stampPut(before, after, { overRead: true, now: 100 });
  assert.equal(after.edited['exAliases.a'], 100);
  assert.equal(after.edited['exAliases.b'], 10);
  assert.deepEqual(after.exAliases, { a: [], b: ['Row'] });
});
