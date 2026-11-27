/* data-manifest.mjs: what a copy of DATA_DIR has to match after a backup, restore or migration.
 * A checksum per file plus record counts. No names or record contents leave the function, but the
 * file paths carry account ids (state-<id>.json, uploads/<id>/), so a manifest is as private as
 * the archive beside it; only its counts and `equal` go into a report. Two manifests are equal
 * exactly when the two directories hold the same bytes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataManifest, compareManifests } from '../scripts/data-manifest.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-manifest-'));
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
  w('db.json', JSON.stringify({ users: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }], creds: [{ id: 'c' }], subs: [], invites: [{}, {}, {}] }));
  w('state-u1.json', '{"workouts":[1,2]}');
  w('state-u2.json', '{"workouts":[]}');
  w('watch-u1.json', '{}');
  w('secret', 'k'.repeat(32));
  w('uploads/u1/a.webp', 'img');
  w('shared/lib.json', '[]');
  return dir;
}

test('counts the records the server keeps and hashes every file', () => {
  const dir = fixture();
  const m = dataManifest(dir);
  assert.deepEqual(m.counts, { users: 2, creds: 1, subs: 0, invites: 3, stateFiles: 2, watchFiles: 1, uploadFiles: 1, files: 7 });
  assert.equal(m.files.length, 7);
  assert.match(m.files.find(f => f.path === 'secret').sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.files.find(f => f.path === 'uploads/u1/a.webp').size, 3);
});

test('reveals no names or record contents', () => {
  const text = JSON.stringify(dataManifest(fixture()));
  for (const secretish of ['Ana', 'Ben', '"workouts"', 'kkkk']) assert.ok(!text.includes(secretish), secretish);
});

test('two copies of the same bytes compare equal; a changed, missing or extra file does not', () => {
  const a = fixture();
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'og-manifest-'));
  fs.cpSync(a, b, { recursive: true });
  assert.deepEqual(compareManifests(dataManifest(a), dataManifest(b)), { equal: true, changed: [], missing: [], extra: [] });

  fs.writeFileSync(path.join(b, 'state-u2.json'), '{"workouts":[9]}');
  fs.rmSync(path.join(b, 'watch-u1.json'));
  fs.writeFileSync(path.join(b, 'state-u3.json'), '{}');
  assert.deepEqual(compareManifests(dataManifest(a), dataManifest(b)), {
    equal: false, changed: ['state-u2.json'], missing: ['watch-u1.json'], extra: ['state-u3.json'],
  });
});

test('ignores the server\'s own transient files so a live copy compares with a stopped one', () => {
  const a = fixture();
  fs.writeFileSync(path.join(a, '.health-123'), '');
  fs.writeFileSync(path.join(a, 'db.json.tmp-9'), 'partial');
  assert.equal(dataManifest(a).counts.files, 7);
});

test('an unreadable db.json is reported, not guessed at', () => {
  const a = fixture();
  fs.writeFileSync(path.join(a, 'db.json'), '{broken');
  assert.equal(dataManifest(a).counts.users, null);
  assert.equal(dataManifest(a).dbReadable, false);
});

test('the paths carry account ids, so the output is private: names and contents still never appear', () => {
  const text = JSON.stringify(dataManifest(fixture()));
  assert.ok(text.includes('state-u1.json') && text.includes('uploads/u1/'), 'paths are kept so a mismatch can be found');
  for (const secretish of ['Ana', 'Ben', '"workouts"', 'kkkk', '"img"']) assert.ok(!text.includes(secretish), secretish);
});

test('uploads still in flight (uploads/<id>/.tmp/) are left out like the other transient files', () => {
  const a = fixture();
  fs.mkdirSync(path.join(a, 'uploads/u1/.tmp'), { recursive: true });
  fs.writeFileSync(path.join(a, 'uploads/u1/.tmp/r4nd0m'), 'half an upload');
  assert.equal(dataManifest(a).counts.files, 7);
  assert.equal(dataManifest(a).counts.uploadFiles, 1);
});

const CLI = fileURLToPath(new URL('../scripts/data-manifest.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('the command line separates "they differ" (1) from "could not tell" (2)', () => {
  const dir = fixture();
  const m = path.join(dir, '..', path.basename(dir) + '.json');
  fs.writeFileSync(m, run(dir).stdout);
  assert.equal(run('--compare', m, m).status, 0);
  const other = fixture(); fs.writeFileSync(path.join(other, 'state-u3.json'), '{}');
  const m2 = m + '.2'; fs.writeFileSync(m2, run(other).stdout);
  assert.equal(run('--compare', m, m2).status, 1);
  assert.equal(run('--compare', m, m + '.missing').status, 2);
  assert.equal(run('--compare', m).status, 2);
  assert.equal(run(path.join(dir, 'no-such-dir')).status, 2);
  const none = run();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage/i);
});
