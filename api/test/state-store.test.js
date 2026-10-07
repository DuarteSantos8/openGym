/* state-store.js: the compare-and-swap PUT /api/data and the MCP write tools share. */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changeState, readSnapshot } from '../state-store.js';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function profile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-state-store-'));
  dirs.push(dir);
  const file = path.join(dir, 'state-u1.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

test('a write from a stale revision is refused and changes nothing', () => {
  const file = profile({ _rev: 10, targetW: 70 });
  changeState(file, 10, s => ({ ...s, targetW: 72 }));
  assert.throws(() => changeState(file, 10, s => ({ ...s, targetW: 71 })), e => e.code === 'CONFLICT' && e.version === 11 && e.state.targetW === 72);
  assert.equal(readSnapshot(file).state.targetW, 72);
});

test('no expected revision overwrites, and the revision still advances', () => {
  const file = profile({ _rev: 4 });
  assert.equal(changeState(file, undefined, () => ({ workouts: [] })).version, 5);
});

test('a held lock answers busy and is left alone, however old it is', () => {
  const file = profile({ _rev: 10 });
  fs.writeFileSync(file + '.lock', String(Date.now() - 3600_000));
  assert.throws(() => changeState(file, 10, s => s), e => e.code === 'BUSY');
  assert.equal(readSnapshot(file).version, 10);
  assert.ok(fs.existsSync(file + '.lock'));
});

test('the lock is released after a refused write', () => {
  const file = profile({ _rev: 1 });
  assert.throws(() => changeState(file, 0, s => s));
  assert.ok(!fs.existsSync(file + '.lock'));
  assert.equal(changeState(file, 1, s => s).version, 2);
});

test('owns only _rev and active', () => {
  const file = profile({ _rev: 10, _ts: 12345 });
  const { state } = changeState(file, 10, s => ({ ...s, targetW: 80, active: { id: 'running' } }));
  assert.equal(state._ts, 12345);
  assert.equal(state._rev, 11);
  assert.equal('active' in state, false);
});

test('an unreadable file throws, unless the caller asked to treat it as empty', () => {
  assert.throws(() => readSnapshot(profile('{not json')));
  assert.deepEqual(readSnapshot(profile('{not json'), { corruptAsEmpty: true }), { state: null, version: 0 });
  assert.deepEqual(readSnapshot(profile('[]'), { corruptAsEmpty: true }), { state: null, version: 0 });
});
