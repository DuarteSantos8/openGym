/* PUT /api/data's stamping (sync-stamps.js): the records of removals and edits never shrink, a
   writer that does not stamp (an older app, an API planner) gets what it changed stamped, and an
   entry held against a removal on record is kept as added back. Unit cases first, then the real
   server.js in a child. (QA 2026-10-06: an offline v1.3.9 phone wiped the RC's removal records; a
   planner's new week was undone by a phone that reconnected with an older change.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { stampPut } from '../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const NOW = 1_800_000_000_000;
const stored = () => ({
  _ts: NOW - 5000, _rev: 3, restSec: 90, queue: { ids: ['a'] }, week: { 1: 'r1' },
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, end: 2 }, { id: 'w2', d: '2026-10-02', start: 3, end: 4 }],
  routines: [{ id: 'r1', name: 'Push', ex: [], _ts: NOW - 9000 }, { id: 'r2', name: 'Pull', ex: [], _ts: NOW - 9000 }],
  favEx: ['bench'],
  deleted: { workouts: { w9: NOW - 4000 } }, edited: { restSec: NOW - 4000 },
});

test('an older app\'s push over the current revision keeps the records and gets its changes stamped', () => {
  const cur = stored();
  const next = clone(cur);
  delete next.deleted; delete next.edited; delete next._rev   // v1.3.9 never knew them
  next.workouts = next.workouts.filter(w => w.id !== 'w2')    // its delete
  next.restSec = 120                                           // its setting
  next.routines[0].name = 'Push A'                             // its routine edit, no stamp of its own
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.equal(next.deleted.workouts.w9, NOW - 4000);         // kept
  assert.ok(next.deleted.workouts.w2 >= NOW);                  // stamped
  assert.ok(next.edited.restSec >= NOW);
  assert.ok(next.routines[0]._ts >= NOW);
  assert.ok(next.routines[0]._f.name >= NOW);
  assert.equal(next.routines[1]._ts, NOW - 9000);              // untouched
});

test('a planner\'s queue and removed routine are stamped; a field it does not send is left alone', () => {
  const cur = stored();
  cur.hints = { swipeSets: true };
  const next = clone(cur);
  delete next.hints;
  next.queue = { ids: ['b'] };
  next.routines = next.routines.filter(r => r.id !== 'r2');
  stampPut(cur, next, { overRead: true, now: NOW });
  assert.ok(next.edited.queue >= NOW);
  assert.ok(next.deleted.routines.r2 >= NOW);
  assert.equal(next.edited.hints, undefined);
});

test('the app stamps its own changes: only the records are joined', () => {
  const cur = stored();
  const next = clone(cur);
  next.edited = { restSec: NOW - 100 };
  next.restSec = 60;
  next.workouts = next.workouts.filter(w => w.id !== 'w2');   // a delete it stamps itself
  next.deleted = { workouts: { w2: NOW - 100 } };
  stampPut(cur, next, { overRead: true, stamped: true, now: NOW });
  assert.deepEqual(next.deleted.workouts, { w9: NOW - 4000, w2: NOW - 100 });
  assert.equal(next.edited.restSec, NOW - 100);
});

test('an entry held against a removal on record is kept, marked as added back', () => {
  const cur = stored();
  cur.deleted.favEx = { squat: NOW - 4000 };
  cur.deleted.workouts.w1 = NOW - 4000;   // a document an older app's merge left inconsistent
  const next = clone(cur);
  next.favEx = ['bench', 'squat'];        // starred again on an older app
  stampPut(cur, next, { overRead: true, now: NOW });
  assert.ok(next.deleted.favEx.squat < 0);
  assert.ok(next.deleted.workouts.w1 < 0);
  assert.deepEqual(next.workouts.map(w => w.id), ['w1', 'w2']);
});

test('a reset keeps its own records; a replace without baseRev keeps the stored ones', () => {
  const cur = stored();
  const reset = { _ts: NOW, resetAt: NOW, workouts: [], routines: [] };
  stampPut(cur, reset, { overRead: false, stamped: true, now: NOW });
  assert.equal(reset.deleted, undefined);
  const replace = { _ts: NOW, workouts: [{ id: 'w9', d: '2026-09-01', start: 1, end: 2 }], routines: [] };
  stampPut(cur, replace, { overRead: false, now: NOW });
  assert.ok(replace.deleted.workouts.w9 < 0);   // the restored workout is kept and stays
  assert.equal(replace.edited.restSec, NOW - 4000);
});

// ---- the real server -------------------------------------------------------------------------
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
test('PUT /api/data: an older app\'s push does not wipe the records, and its delete is stamped', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-stamps-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const headers = { Cookie: `gymsid=${mintSession('u1')}`, 'Content-Type': 'application/json' };
  const put = async body => { const r = await fetch(`${base}/api/data`, { method: 'PUT', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async () => (await fetch(`${base}/api/data`, { headers })).json();

  // the RC app pushes a delete it stamped itself
  let r = await put({ state: { _ts: 1, workouts: [{ id: 'w2', d: '2026-10-02', start: 3, end: 4 }], routines: [], deleted: { workouts: { w1: 1000 } } }, stamped: true });
  assert.equal(r.status, 200);
  // an older app, which read rev 1, pushes its copy without the records and with w2 deleted
  r = await put({ state: { _ts: 2, workouts: [], routines: [] }, baseRev: 1 });
  assert.equal(r.status, 200);
  const doc = (await get()).state;
  assert.equal(doc.deleted.workouts.w1, 1000);
  assert.ok(doc.deleted.workouts.w2 > 1000);
});

// RC review 2026-10-07: a v1.3.9 phone saving a routine rebuilt each exercise from the fields it
// knows, and the pyramid made on an updated phone was deleted on every device.
test('an older app saving a routine keeps the pyramid it does not know', () => {
  const cur = stored();
  cur.routines[0].ex = [
    { id: '0025', sets: 4, mode: 'reps', reps: 12, weight: 40, pyramid: [12, 10, 8, 'max'], pyramidRest: [60, 90, 120, 0] },
    { id: '0032', sets: 3, mode: 'reps', reps: 8, weight: 100, sg: 'g1' },
  ];
  const next = clone(cur);
  delete next.edited; delete next.deleted;
  next.routines[0].ex = [
    { id: '0025', sets: 4, mode: 'reps', reps: 12, weight: 45 },   // its sheet: the weight changed, the pyramid gone
    { id: '0032', sets: 3, mode: 'reps', reps: 8, weight: 100 },  // it took the superset apart: that stays
  ];
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.deepEqual(next.routines[0].ex[0], { id: '0025', sets: 4, mode: 'reps', reps: 12, weight: 45, pyramid: [12, 10, 8, 'max'], pyramidRest: [60, 90, 120, 0] });
  assert.equal('sg' in next.routines[0].ex[1], false);
  assert.ok(next.routines[0]._f.ex >= NOW);   // its weight change is still an edit of its own
});

test('an older app keeps the fields it does not know everywhere: settings, entries, sets', () => {
  const cur = stored();
  cur.accentCustom = '#ff00aa'; cur.showRir = true;
  cur.customEx = [{ id: 'c1', n: 'Curl', media: { hash: 'h' }, future: 1 }];
  cur.workouts[0].entries = [{ id: 'bench', sets: [{ w: 100, r: 5, done: true, max: true }, { w: 90, r: 8, done: true }] }];
  cur.workouts[0].newer = 'x';
  const next = clone(cur);
  delete next.accentCustom; delete next.showRir;
  delete next.customEx[0].media; delete next.customEx[0].future;
  next.workouts[0].entries[0].sets = [{ w: 100, r: 6, done: true }, { w: 90, r: 8 }];
  delete next.workouts[0].newer;
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.equal(next.accentCustom, '#ff00aa');
  assert.equal('showRir' in next, false);                     // v1.3.9 removes that one itself
  assert.deepEqual(next.customEx[0], { id: 'c1', n: 'Curl', future: 1, _ts: next.customEx[0]._ts, _f: next.customEx[0]._f });
  assert.deepEqual(next.workouts[0].entries[0].sets, [{ w: 100, r: 6, done: true, max: true }, { w: 90, r: 8 }]);
  assert.equal(next.workouts[0].newer, 'x');
});

test('a set taken out of the middle is not guessed at, and the app\'s own pushes are left as sent', () => {
  const cur = stored();
  cur.workouts[0].entries = [{ id: 'bench', sets: [{ w: 1, max: true }, { w: 2 }, { w: 3, max: true }] }];
  const old = clone(cur);
  old.workouts[0].entries[0].sets = [{ w: 1 }, { w: 3 }];
  stampPut(cur, old, { overRead: true, stamped: false, now: NOW });
  assert.deepEqual(old.workouts[0].entries[0].sets, [{ w: 1 }, { w: 3 }]);
  const app = clone(cur);
  delete app.routines[0].name; delete app.queue;
  stampPut(cur, app, { overRead: true, stamped: true, now: NOW });
  assert.equal('name' in app.routines[0], false);
  assert.equal('queue' in app, false);
});

test('a reset from an older app is not refilled from the profile it wiped', () => {
  const cur = stored();
  cur.accentCustom = '#ff00aa';
  const next = { _ts: NOW, resetAt: NOW, workouts: [], routines: [] };
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.equal('accentCustom' in next, false);
});

// RC review 2026-10-07: a v1.3.9 phone back from a dead spot got the 409, its merge kept its
// whole older copy (newer `_ts`), and its push set the rest timer, the plan day and the routine's
// sets back to what they were before an updated phone changed them.
test('an older app back from offline does not set back settings, plan days or entry fields changed after its copy', () => {
  const cur = stored();
  cur.restSec = 60; cur.week = { 1: 'r2' }; cur.edited = { restSec: NOW - 1000, 'week.1': NOW - 1000, theme: NOW - 9000 };
  cur.theme = 'dark';
  cur.routines[0] = { id: 'r1', name: 'Push', ex: [{ id: 'bench', sets: 5 }], _ts: NOW - 1000, _f: { ex: NOW - 1000 } };
  const old = clone(cur);
  old.edited = { restSec: NOW - 8000, theme: NOW - 9000 };         // the record it read before going offline
  old.restSec = 90; old.week = { 1: 'r1' };                        // its older copy
  old.theme = 'light';                                              // its own change, of a setting nobody changed since
  old.routines[0] = { id: 'r1', name: 'Push A', ex: [{ id: 'bench', sets: 3 }], _ts: NOW - 500 };   // renamed offline, older sets
  old._ts = NOW - 500;
  stampPut(cur, old, { overRead: true, stamped: false, now: NOW });
  assert.equal(old.restSec, 60);
  assert.deepEqual(old.week, { 1: 'r2' });
  assert.equal(old.theme, 'light');
  assert.ok(old.edited.theme >= NOW);
  assert.equal(old.routines[0].name, 'Push A');
  assert.deepEqual(old.routines[0].ex, [{ id: 'bench', sets: 5 }]);
  assert.ok(old.routines[0]._f.name >= NOW);
  assert.equal(old.routines[0]._f.ex, NOW - 1000);
});

test('an older app that read the latest change still changes it, and one that sends no record goes through', () => {
  const cur = stored();
  cur.edited = { restSec: NOW - 1000 };
  const seen = clone(cur);
  seen.restSec = 45;
  stampPut(cur, seen, { overRead: true, stamped: false, now: NOW });
  assert.equal(seen.restSec, 45);
  assert.ok(seen.edited.restSec >= NOW);
  const blind = clone(cur); delete blind.edited;
  blind.restSec = 30;
  stampPut(cur, blind, { overRead: true, stamped: false, now: NOW });
  assert.equal(blind.restSec, 30);
  // a replace (no baseRev: an older app's backup import) is not held against the record either
  const replace = clone(cur); replace.edited = {}; replace.restSec = 120;
  stampPut(cur, replace, { overRead: false, stamped: false, now: NOW });
  assert.equal(replace.restSec, 120);
});

// RC review 2026-10-07: an older app sends back the write ids it read, and the server took the
// difference to the stored ones for a setting it changed: `edited._wid`, `edited._wids`.
test('an older app\'s push never gets the write ids stamped as settings, and an old such stamp goes', () => {
  const cur = stored();
  cur._wid = 'new'; cur._wids = ['a', 'b'];
  cur.edited = { ...cur.edited, _wid: NOW - 7000 };
  const old = clone(cur);
  old._wid = 'older'; old._wids = ['a'];
  delete old.edited;
  old.edited = { restSec: NOW - 4000 };
  stampPut(cur, old, { overRead: true, stamped: false, now: NOW });
  assert.equal('_wid' in old.edited, false);
  assert.equal('_wids' in old.edited, false);
});

// An older app takes the revision it is told for the copy it sent and reads the profile again only
// once the revision moves (v1.3.9 pullState). When the server put back what it left out, the
// stored document goes one revision further, so that app's next check reads it.
test('PUT /api/data: a document the server corrected for an older app is one revision further than it was told', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-stamps-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const headers = { Cookie: `gymsid=${mintSession('u1')}`, 'Content-Type': 'application/json' };
  const put = async body => { const r = await fetch(`${base}/api/data`, { method: 'PUT', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const rev = async () => (await (await fetch(`${base}/api/data/rev`, { headers })).json()).rev;
  const pyr = { id: 'r1', name: 'P', ex: [{ id: 'sq', sets: 4, pyramid: [12, 10, 8, 6] }], _ts: 5 };
  let r = await put({ state: { _ts: 1, workouts: [], routines: [pyr] }, stamped: true });
  assert.equal(r.body.rev, 1);
  // an older app saves the routine without the pyramid it does not know
  r = await put({ state: { _ts: 2, workouts: [], routines: [{ id: 'r1', name: 'P', ex: [{ id: 'sq', sets: 4 }], _ts: 6 }] }, baseRev: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.equal(await rev(), 3);
  // the same old app with nothing to put back: one revision, as always
  r = await put({ state: { _ts: 3, workouts: [], routines: [{ id: 'r1', name: 'P2', ex: [{ id: 'sq', sets: 4, pyramid: [12, 10, 8, 6] }], _ts: 7 }] }, baseRev: 3 });
  assert.equal(r.body.rev, 4);
  assert.equal(await rev(), 4);
});

test('an older app that adds an exercise to a routine with one of them twice keeps the pyramids of the others', () => {
  const cur = stored();
  cur.routines[0].ex = [{ id: 'sq', sets: 4, pyramid: [12, 10, 8, 6] }, { id: 'bench', sets: 3 }, { id: 'sq', sets: 3, pyramid: [5, 5, 3] }];
  const next = clone(cur);
  delete next.edited;
  next.routines[0].ex = [{ id: 'sq', sets: 4 }, { id: 'row', sets: 3 }, { id: 'bench', sets: 3 }, { id: 'sq', sets: 3 }, { id: 'curl', sets: 2 }];
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.deepEqual(next.routines[0].ex.map(e => e.pyramid || null), [[12, 10, 8, 6], null, null, [5, 5, 3], null]);
});

// RC verify 2026-10-07: an older app that changed the same setting, plan day or routine field twice
// in a row had its second change set back to its first. Its own push does not move the revision it
// knows, so it never reads the stamp the server gave its first change, and the copy it sends still
// carries the record from before it: the server took its second change for a stale copy.
test('an older app changing the same setting, plan day and routine field twice in a row keeps the second change', () => {
  let cur = stored();
  cur.edited = { restSec: NOW - 4000, 'week.1': NOW - 4000 };
  cur.routines[0] = { id: 'r1', name: 'Legs', ex: [{ id: 'a', sets: 3 }], _ts: NOW - 4000, _f: { name: NOW - 4000, ex: NOW - 4000 } };
  const old = clone(cur);                            // what v1.3.9 read, record and all
  const put = (doc, now) => { const next = clone(doc); stampPut(clone(cur), next, { overRead: true, stamped: false, now }); cur = next; return next; };
  // 1st change
  old.restSec = 120; old.week = { 1: ['r1'] };
  old.routines[0].name = 'Legs B'; old.routines[0].ex.push({ id: 'b', sets: 3 }); old.routines[0]._ts = NOW - 100;
  old.routines.reverse(); old._ts = NOW - 100;
  put(old, NOW);
  assert.equal(cur.restSec, 120);
  // 2nd change of the same fields, on the same copy (it never read the one it wrote)
  old.restSec = 150; old.week = { 1: ['r1', 'r2'] };
  const r1 = old.routines.find(r => r.id === 'r1');
  r1.name = 'Legs C'; r1.ex.push({ id: 'c', sets: 3 }); r1._ts = NOW + 900;
  old.routines.reverse(); old._ts = NOW + 900;
  put(old, NOW + 1000);
  assert.equal(cur.restSec, 150);
  assert.deepEqual(cur.week, { 1: ['r1', 'r2'] });
  assert.equal(cur.routines.find(r => r.id === 'r1').name, 'Legs C');
  assert.deepEqual(cur.routines.find(r => r.id === 'r1').ex.map(e => e.id), ['a', 'b', 'c']);
  assert.deepEqual(cur.routines.map(r => r.id), ['r1', 'r2']);
  assert.ok(cur.edited.restSec >= NOW + 1000);
  // a 3rd write of something else, then a 4th of the first field again: still its own
  old.theme = 'dark'; put(old, NOW + 2000);
  old.restSec = 75; put(old, NOW + 3000);
  assert.equal(cur.restSec, 75);
  assert.equal(cur.theme, 'dark');
  assert.equal(cur.routines.find(r => r.id === 'r1').name, 'Legs C');
});

test('a stamp the server gave one older app still holds against another that read an older copy', () => {
  let cur = stored();
  cur.edited = { restSec: NOW - 4000 };
  const before = clone(cur);
  before.edited = { restSec: NOW - 8000 };          // the other phone read an earlier copy
  const one = clone(cur);
  one.restSec = 120;
  stampPut(clone(cur), one, { overRead: true, stamped: false, now: NOW });
  cur = one;
  const other = clone(before);                      // back from a dead spot: its merge kept its own
  other.restSec = 90;
  stampPut(clone(cur), other, { overRead: true, stamped: false, now: NOW + 1000 });
  assert.equal(other.restSec, 120);
  // and an updated app's write in between keeps the record of the stamp still stored: the older
  // app's merge after the 409 keeps its own record of edits, so its next change is still its own
  const app = clone(one); app.theme = 'x';
  stampPut(clone(one), app, { overRead: true, stamped: true, now: NOW + 2000 });
  assert.equal(app._unstamped?.ed?.restSec, one.edited.restSec);
});

test('an older app\'s own next change goes through after another device wrote in between; its old copy coming back does not', () => {
  let cur = stored();
  const put = (doc, now, stamped = false) => { const next = clone(doc); stampPut(clone(cur), next, { overRead: true, stamped, now }); cur = next; return next; };
  const old = clone(cur);                            // what v1.3.9 read, record and all
  old.restSec = 180;
  old.workouts.push({ id: 'w3', d: '2026-10-03', start: 5, end: 6, entries: [{ id: 'bench', sets: [{ w: 60, r: 5 }] }], _ts: NOW - 50 });
  put(old, NOW);
  old.workouts[2].entries[0].sets.push({ w: 70, r: 5 });
  put(old, NOW + 1000);
  assert.equal(cur.workouts[2].entries[0].sets.length, 2);
  // an updated app changes the queue (and reads the server's copy, so it sends the stamps)
  const app = clone(cur); delete app._unstamped; delete app._prior;
  app.queue = { ids: ['b'] }; app.edited = { ...app.edited, queue: NOW + 2000 };
  put(app, NOW + 2000, true);
  assert.equal('_prior' in app, false);
  // the older app, on its own copy (its merge after the 409 keeps its older record and the queue
  // from before): a 3rd logged set and a second change of the rest time are its own and land, the
  // queue it still holds is the one from before and stays set back
  old.restSec = 270; old.workouts[2].entries[0].sets.push({ w: 80, r: 3 });
  put(old, NOW + 3000);
  assert.equal(cur.restSec, 270);
  assert.deepEqual(cur.workouts[2].entries[0].sets.map(x => x.w), [60, 70, 80]);
  assert.deepEqual(cur.queue, { ids: ['b'] });
  // a new pick of the queue it makes before it reads the profile again is its own choice
  old.queue = { ids: ['c'] };
  put(old, NOW + 4000);
  assert.deepEqual(cur.queue, { ids: ['c'] });
  assert.ok(cur.edited.queue >= NOW + 4000);
  // a workout that is removed takes its history with it
  assert.ok(Object.keys(cur._prior).some(k => k.startsWith('workouts|w3|')));
  old.workouts = old.workouts.filter(w => w.id !== 'w3');
  put(old, NOW + 5000);
  assert.ok(!Object.keys(cur._prior || {}).some(k => k.startsWith('workouts|w3|')));
  assert.ok(cur.deleted.workouts.w3 > 0);
});

test('a field with no history of its earlier values (stamped before it was kept) is put back as before', () => {
  const cur = stored();
  cur.edited = { restSec: NOW - 1000 };              // changed on an updated app since the old copy
  const old = clone(cur); old.edited = { restSec: NOW - 8000 };
  old.restSec = 45;                                   // a value it never held: without `_prior`, still put back
  stampPut(clone(cur), old, { overRead: true, stamped: false, now: NOW });
  assert.equal(old.restSec, 90);
});

test('PUT /api/data: an older app\'s two changes of one setting in a row both land, and the note stays on the server', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-stamps-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const headers = { Cookie: `gymsid=${mintSession('u1')}`, 'Content-Type': 'application/json' };
  const put = async body => { const r = await fetch(`${base}/api/data`, { method: 'PUT', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async () => (await (await fetch(`${base}/api/data`, { headers })).json());
  // an updated app wrote last: the copy carries a record of edits
  let r = await put({ state: { _ts: 1, restSec: 100, edited: { restSec: 1 }, workouts: [], routines: [] }, stamped: true });
  const old = (await get()).state;                   // v1.3.9 reads it once
  old.restSec = 120;
  r = await put({ state: old, baseRev: r.body.rev });
  assert.equal(r.status, 200);
  old.restSec = 150;                                 // and changes it again, on the copy it has
  r = await put({ state: old, baseRev: r.body.rev });
  assert.equal(r.status, 200);
  const now = await get();
  assert.equal(now.state.restSec, 150);
  assert.equal(now.rev, r.body.rev);                 // nothing set back, so nothing to read again
  assert.equal('_unstamped' in now.state, false);
  assert.equal('_prior' in now.state, false);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-u1.json'), 'utf8'));
  assert.ok(onDisk._unstamped?.ed?.restSec > 0);
  assert.equal(onDisk._prior?.restSec?.length, 2);   // 100, then 120
});
