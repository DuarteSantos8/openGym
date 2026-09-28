/* Which stored photos and videos go, and — the half that matters more — which never do.
   A file goes when the profile's own readable state has not referenced it for the grace period
   (14 days; one hour when the quota is full; none for an explicit sweep). Nothing is ever
   deleted because something is missing or unreadable: the state file, the user in db.json, or
   .gc.json. Other devices and stashes may still hold refs that are gone from the server state,
   and the grace is what keeps their files for them. In-process, with the clock injected. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMediaStore, mediaLimits, MediaError } from '../media.js';
import * as M from './media-samples.mjs';

const DAY = 86400000, HOUR = 3600000;
const quiet = { warn() {}, error() {}, log() {} };

function setup(t, { limits = {}, states = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'uploads');
  const clock = { t: 1_800_000_000_000 };
  const S = new Map(Object.entries(states));
  const warnings = [];
  const store = createMediaStore({
    dir, limits: { ...mediaLimits({}), ...limits }, now: () => clock.t,
    readState: uid => {
      const v = S.get(uid);
      if (v instanceof Error) throw v;
      return v ?? null;
    },
    log: { ...quiet, warn: m => warnings.push(m) }
  });
  // Puts a file in place the way an upload leaves it, before the store has looked.
  const place = (uid, bytes, ext = 'jpg') => {
    const d = path.join(dir, uid);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    const h = M.sha(bytes);
    fs.writeFileSync(path.join(d, `${h}.${ext}`), bytes, { mode: 0o600 });
    return h;
  };
  const files = uid => { try { return fs.readdirSync(path.join(dir, uid)).filter(n => !n.startsWith('.')).sort(); } catch { return []; } };
  const marks = uid => JSON.parse(fs.readFileSync(path.join(dir, uid, '.gc.json'), 'utf8'));
  return { dir, clock, S, store, place, files, marks, warnings };
}
const ref = (...hashes) => ({ customEx: hashes.map((h, i) => ({ id: 'cx' + i, n: 'x', bp: 'back', custom: true, media: { kind: 'image', hash: h, mime: 'image/jpeg', size: 1, width: 1, height: 1, at: 1 } })) });

test('noteState marks a file the state stopped referencing and clears the mark when it is back', t => {
  const h = setup(t);
  const a = h.place('u1', M.jpeg()), b = h.place('u1', M.jpeg());
  assert.equal(h.store.noteState('u1', ref(a, b)), false, 'both referenced: nothing to write');
  assert.equal(fs.existsSync(path.join(h.dir, 'u1', '.gc.json')), false);

  assert.equal(h.store.noteState('u1', ref(a)), true);
  assert.deepEqual(h.marks('u1'), { [b]: h.clock.t });

  h.clock.t += DAY;
  assert.equal(h.store.noteState('u1', ref(a)), false, 'an existing mark keeps its time');
  assert.deepEqual(h.marks('u1'), { [b]: h.clock.t - DAY });

  assert.equal(h.store.noteState('u1', ref(a, b)), true);
  assert.deepEqual(h.marks('u1'), {});
});

test('noteState does nothing at all for a profile that never uploaded', t => {
  const h = setup(t);
  assert.equal(h.store.noteState('u1', ref('a'.repeat(64))), false);
  assert.equal(fs.existsSync(h.dir), false, 'no uploads folder is created by a state push');
});

test('the hourly sweep keeps referenced files and removes the rest only after the grace', t => {
  const h = setup(t);
  const keep = h.place('u1', M.jpeg()), drop = h.place('u1', M.jpeg(3000));
  h.S.set('u1', ref(keep));
  assert.deepEqual(h.store.usage('u1'), { bytes: 4000, count: 2, quotaBytes: 200 * 1048576 });
  h.store.noteState('u1', ref(keep));

  h.clock.t += 14 * DAY - 1;
  assert.deepEqual(h.store.sweep('u1'), { removed: 0, freedBytes: 0, skipped: false });
  assert.equal(h.files('u1').length, 2, 'a day short of the grace: still there');

  h.clock.t += 1;
  assert.deepEqual(h.store.sweep('u1'), { removed: 1, freedBytes: 3000, skipped: false });
  assert.deepEqual(h.files('u1'), [`${keep}.jpg`]);
  assert.deepEqual(h.store.usage('u1'), { bytes: 1000, count: 1, quotaBytes: 200 * 1048576 });
  assert.deepEqual(h.marks('u1'), {}, 'the mark goes with the file');
});

test('a file nobody marked yet starts its grace at the first sweep that sees it unreferenced', t => {
  const h = setup(t);
  const x = h.place('u1', M.jpeg());
  h.S.set('u1', ref());
  assert.equal(h.store.sweep('u1').removed, 0);
  assert.deepEqual(h.marks('u1'), { [x]: h.clock.t });
  h.clock.t += 14 * DAY;
  assert.equal(h.store.sweep('u1').removed, 1);
});

test('an explicit sweep (grace 0) removes every unreferenced file at once', t => {
  const h = setup(t);
  const keep = h.place('u1', M.jpeg()), a = h.place('u1', M.png()), b = h.place('u1', M.gif(), 'gif');
  h.S.set('u1', ref(keep));
  const r = h.store.sweep('u1', { graceMs: 0 });
  assert.equal(r.removed, 2);
  assert.deepEqual(h.files('u1'), [`${keep}.jpg`]);
  assert.ok(!h.store.has('u1', a) && !h.store.has('u1', b));
});

test('a profile whose state cannot be read is never swept — missing, unparsable or throwing', t => {
  const h = setup(t);
  for (const [uid, state] of [['gone', undefined], ['bad', null], ['arr', []], ['boom', new Error('EIO')]]) {
    h.place(uid, M.jpeg());
    if (state !== undefined) h.S.set(uid, state);
    h.clock.t += 30 * DAY;
    const r = h.store.sweep(uid, { graceMs: 0 });
    assert.deepEqual(r, { removed: 0, freedBytes: 0, skipped: true }, uid);
    assert.equal(h.files(uid).length, 1, uid);
  }
});

test('an unreadable .gc.json is no marks: the grace starts over and nothing is deleted for it', t => {
  const h = setup(t);
  const x = h.place('u1', M.jpeg());
  h.S.set('u1', ref());
  h.store.sweep('u1');                                   // marked now
  h.clock.t += 20 * DAY;
  fs.writeFileSync(path.join(h.dir, 'u1', '.gc.json'), '{"torn');
  assert.equal(h.store.sweep('u1').removed, 0, 'a mark that cannot be read is not a mark');
  assert.deepEqual(h.marks('u1'), { [x]: h.clock.t }, 'a fresh mark replaces the torn file');
  h.clock.t += 14 * DAY;
  assert.equal(h.store.sweep('u1').removed, 1);
});

test('.gc.json turned into a directory: the hourly sweep deletes nothing, noteState throws for the caller to catch', t => {
  const h = setup(t);
  h.place('u1', M.jpeg());
  h.S.set('u1', ref());
  fs.mkdirSync(path.join(h.dir, 'u1', '.gc.json'));
  h.clock.t += 60 * DAY;
  assert.equal(h.store.sweep('u1').removed, 0);
  assert.equal(h.files('u1').length, 1);
  assert.throws(() => h.store.noteState('u1', { customEx: [] }));
  assert.equal(fs.existsSync(path.join(h.dir, 'u1', '.gc.json.tmp')), false, 'the failed write leaves no temp file');
});

test('sweepAll with an empty db.users removes no folder and no file, and says so once', t => {
  const h = setup(t);
  h.place('u1', M.jpeg());
  h.place('u2', M.jpeg());
  h.S.set('u1', ref());
  h.S.set('u2', ref());
  h.clock.t += 60 * DAY;
  for (let i = 0; i < 3; i++) {
    const r = h.store.sweepAll({ uids: [], graceMs: 0 });
    assert.equal(r.removed, 0);
    assert.equal(r.orphans, 2);
  }
  assert.equal(h.files('u1').length + h.files('u2').length, 2);
  assert.equal(h.warnings.length, 2, 'one line per folder per process, not one per hour');
  assert.match(h.warnings[0], /belongs to no profile/);
});

test('sweepAll sweeps the profiles it is given, and only when their state reads', t => {
  const h = setup(t);
  h.place('u1', M.jpeg());
  h.place('u2', M.jpeg());
  h.S.set('u1', ref());           // readable, references nothing
  // u2: no state at all
  const r = h.store.sweepAll({ uids: ['u1', 'u2'], graceMs: 0 });
  assert.equal(r.removed, 1);
  assert.equal(r.swept, 1);
  assert.equal(r.skipped, 1);
  assert.equal(h.files('u1').length, 0);
  assert.equal(h.files('u2').length, 1);
});

test('temp files: the hourly pass removes those older than an hour, boot removes them all', t => {
  const h = setup(t);
  h.place('u1', M.jpeg());
  const tmp = path.join(h.dir, 'u1', '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'old'), 'x');
  fs.writeFileSync(path.join(tmp, 'new'), 'x');
  const old = new Date(h.clock.t - 2 * HOUR), fresh = new Date(h.clock.t - 10 * 60000);
  fs.utimesSync(path.join(tmp, 'old'), old, old);
  fs.utimesSync(path.join(tmp, 'new'), fresh, fresh);
  const r = h.store.sweepAll({ uids: [] });
  assert.equal(r.tmp, 1);
  assert.deepEqual(fs.readdirSync(tmp), ['new']);
  assert.equal(h.store.cleanTmp(), 1);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('dotfiles and unknown names are never blobs', t => {
  const h = setup(t);
  const x = h.place('u1', M.jpeg());
  const d = path.join(h.dir, 'u1');
  fs.writeFileSync(path.join(d, '.gc.json'), '{}');
  fs.writeFileSync(path.join(d, `${x}.svg`), '<svg/>');
  fs.writeFileSync(path.join(d, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(d, `.${'e'.repeat(64)}.jpg`), 'x');
  assert.deepEqual(h.store.usage('u1'), { bytes: 1000, count: 1, quotaBytes: 200 * 1048576 });
  h.S.set('u1', ref());
  h.store.sweep('u1', { graceMs: 0 });
  assert.deepEqual(fs.readdirSync(d).sort(), ['.gc.json', `.${'e'.repeat(64)}.jpg`, '.tmp', `${x}.svg`, 'notes.txt'].filter(n => n !== '.tmp').sort());
});

test('removeUser deletes the whole folder, and an id that sanitises to nothing is refused', t => {
  const h = setup(t);
  h.place('u1', M.jpeg());
  h.place('u2', M.jpeg());
  h.store.removeUser('u1');
  assert.equal(fs.existsSync(path.join(h.dir, 'u1')), false);
  assert.equal(fs.existsSync(path.join(h.dir, 'u2')), true);
  assert.equal(h.store.usage('u1').count, 0);
  // '../..' would otherwise name uploads/ itself — everybody's files.
  assert.throws(() => h.store.removeUser('../..'));
  assert.throws(() => h.store.removeUser(''));
  assert.equal(fs.existsSync(path.join(h.dir, 'u2')), true);
});

test('under quota pressure the grace is one hour', async t => {
  // 2500 bytes of quota; 1000 already stored and unreferenced; a 2000-byte upload needs room.
  const h = setup(t, { limits: { quotaMB: 2500 / 1048576, minFreeMB: 0 } });
  const old = h.place('u1', M.jpeg());
  h.S.set('u1', ref());
  h.store.noteState('u1', ref());                      // marked now
  const next = M.jpeg(2000);

  h.clock.t += 30 * 60000;                             // half an hour: still protected
  await assert.rejects(h.store.receive('u1', M.sha(next), M.fakeReq(next)),
    e => e instanceof MediaError && e.status === 413 && e.code === 'media-quota' && e.extra.quotaMB > 0);
  assert.ok(h.store.has('u1', old));

  h.clock.t += 31 * 60000;                             // past the hour: it makes room
  const r = await h.store.receive('u1', M.sha(next), M.fakeReq(next));
  assert.equal(r.status, 201);
  assert.ok(!h.store.has('u1', old));
  assert.equal(h.store.usage('u1').bytes, 2000);
});

test('a new upload nobody references yet is marked, so the grace also covers a push that never comes', async t => {
  const h = setup(t, { limits: { minFreeMB: 0 } });
  const a = M.jpeg(), b = M.jpeg();
  h.S.set('u1', ref(M.sha(b)));
  await h.store.receive('u1', M.sha(a), M.fakeReq(a));
  await h.store.receive('u1', M.sha(b), M.fakeReq(b));
  assert.deepEqual(h.marks('u1'), { [M.sha(a)]: h.clock.t }, 'the referenced one is not marked');
});

// The photos and videos of a logged workout (workouts[].media) keep their files exactly like an
// exercise's picture: a file only a workout refers to is never swept, and taking it off the
// workout starts its grace like any other.
const wref = (...hashes) => ({ workouts: [{ id: 'w1', d: '2026-09-20', start: 1, end: 2, entries: [], media: hashes.map((h, i) => ({ kind: 'image', hash: h, mime: 'image/jpeg', size: 1, width: 1, height: 1, at: i + 1 })) }] });

test('a file referenced only by a workout is never swept, whatever the grace', t => {
  const h = setup(t);
  const photo = h.place('u1', M.jpeg()), gone = h.place('u1', M.jpeg(3000));
  h.S.set('u1', wref(photo));
  assert.equal(h.store.noteState('u1', wref(photo)), true, 'the other file gets its mark');
  assert.deepEqual(Object.keys(h.marks('u1')), [gone]);
  h.clock.t += 365 * DAY;
  assert.deepEqual(h.store.sweep('u1'), { removed: 1, freedBytes: 3000, skipped: false });
  assert.deepEqual(h.store.sweep('u1', { graceMs: 0 }), { removed: 0, freedBytes: 0, skipped: false });
  assert.deepEqual(h.files('u1'), [`${photo}.jpg`]);
});

test('a photo taken off a workout is marked by the next state push and swept after the grace', t => {
  const h = setup(t);
  const a = h.place('u1', M.jpeg()), b = h.place('u1', M.jpeg(2000));
  h.S.set('u1', wref(a, b));
  assert.equal(h.store.noteState('u1', wref(a, b)), false);
  // The owner removes b from the workout; the push lands.
  h.S.set('u1', wref(a));
  assert.equal(h.store.noteState('u1', wref(a)), true);
  assert.deepEqual(h.marks('u1'), { [b]: h.clock.t });
  h.clock.t += 14 * DAY - 1;
  assert.equal(h.store.sweep('u1').removed, 0, 'inside the grace another device may still show it');
  h.clock.t += 1;
  assert.deepEqual(h.store.sweep('u1'), { removed: 1, freedBytes: 2000, skipped: false });
  assert.deepEqual(h.files('u1'), [`${a}.jpg`]);
});
