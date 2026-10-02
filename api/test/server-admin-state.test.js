/* The admin routes read state files nobody validated. PUT /api/data drops null and shapeless
   entries and refuses a non-array `workouts`/`routines` (QA C16/C19), but a document written
   before it did still sits on disk and answers to nobody — and every one of these routes walks
   those lists and dereferences what it finds. One throw is a 500 for the whole drill-down: the
   sheet never leaves "Loading…", and the Disable button lives inside that sheet, so the account
   an operator opened the dashboard to stop stays un-disableable. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const ADMIN = 'u_adm_1', VICTIM = 'u_vic_1';
const asAdmin = { Cookie: `gymsid=${mintSession(ADMIN)}`, 'Content-Type': 'application/json' };

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
      { id: VICTIM, name: 'Mallory', created: new Date().toISOString() }
    ], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  // The boot line is fine; anything that looks like a stack frame after this is a defect.
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  h.plant = S => fs.writeFileSync(path.join(h.dataDir, `state-${VICTIM}.json`), JSON.stringify(S));
  h.get = async p => { const r = await fetch(`${h.api}${p}`, { headers: asAdmin }); return { status: r.status, body: await r.json() }; };
  return h;
}

// One good entry of each kind, so every case below can say what survived as well as what did not.
const okW = { id: 'w1', name: 'Fine', d: '2026-09-18', start: 1, end: 2, entries: [{ id: 'e', sets: [{ w: 10, r: 5, done: true }] }] };
const okR = { id: 'r1', name: 'Full body', emoji: '💪', ex: [{ id: '0001', sets: 3, reps: 10 }] };
const okB = { d: '2026-09-01', w: 80 };

/* The shapes v1.3.7 accepted through PUT /api/data, one per line. `null` is the one the field
   reports came in with; the rest are the same mistake one field over. */
const DOCS = {
  'a null routine entry': { workouts: [okW], routines: [null, okR], bodyweight: [okB], unit: 'kg' },
  'shapeless routine entries': { workouts: [okW], routines: [7, 'x', [], okR], bodyweight: [okB], unit: 'kg' },
  'a null workout entry': { workouts: [null, okW], routines: [okR], bodyweight: [okB], unit: 'kg' },
  'shapeless workout entries': { workouts: ['x', [], okW], routines: [okR], bodyweight: [okB], unit: 'kg' },
  'a null body-weight entry': { workouts: [okW], routines: [okR], bodyweight: [null, okB], unit: 'kg' },
  'shapeless body-weight entries': { workouts: [okW], routines: [okR], bodyweight: ['x', 7, [], okB], unit: 'kg' },
  'a null customEx entry': { workouts: [okW], routines: [okR], bodyweight: [okB], customEx: [null], unit: 'kg' },
  'lists that are objects, not arrays': { workouts: { a: 1 }, routines: { a: 1 }, bodyweight: { a: 1 }, unit: 'kg' },
  'lists that are null': { workouts: null, routines: null, bodyweight: null, unit: 'kg' },
  'no lists at all': { unit: 'kg' }
};

test('GET /api/admin/user opens a profile whose stored state predates the entry filter', async t => {
  const h = await startServer(t);
  for (const [what, doc] of Object.entries(DOCS)) {
    h.plant(doc);
    const r = await h.get(`/api/admin/user?id=${VICTIM}`);
    assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body)}`);
    // Every list the sheet counts and walks comes back usable — the drill-down renders it
    // without a guard of its own for anything but the workout entries.
    for (const k of ['routines', 'bodyweight', 'workouts']) {
      assert.ok(Array.isArray(r.body[k]), `${what}: ${k} is an array`);
      assert.equal(r.body[k].some(x => !x || typeof x !== 'object' || Array.isArray(x)), false, `${what}: ${k} holds only entries`);
    }
  }
  // The good entries are still there, and a routine's exercise count is a number in every case.
  h.plant(DOCS['a null routine entry']);
  let r = await h.get(`/api/admin/user?id=${VICTIM}`);
  assert.deepEqual(r.body.routines, [{ id: 'r1', name: 'Full body', emoji: '💪', count: 1 }]);
  assert.deepEqual(r.body.workouts.map(w => w.id), ['w1']);
  assert.deepEqual(r.body.bodyweight, [okB]);
  h.plant({ routines: [{ id: 'r2', name: 'Broken', ex: 'nope' }] });
  r = await h.get(`/api/admin/user?id=${VICTIM}`);
  assert.deepEqual(r.body.routines, [{ id: 'r2', name: 'Broken', count: 0 }]);   // an `ex` that is not a list counts as no exercises
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
});

test('GET /api/admin/user leaves a workout\'s photos and videos out', async t => {
  const h = await startServer(t);
  const ref = { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 10, width: 8, height: 6, at: 1 };
  h.plant({ workouts: [{ ...okW, media: [ref] }], routines: [okR], bodyweight: [okB], unit: 'kg' });
  const r = await h.get(`/api/admin/user?id=${VICTIM}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.workouts.map(w => w.id), ['w1']);
  assert.equal('media' in r.body.workouts[0], false);
  assert.equal(JSON.stringify(r.body).includes('a'.repeat(64)), false);
});

test('the user list and the disable switch survive the same document', async t => {
  const h = await startServer(t);
  for (const [what, doc] of Object.entries(DOCS)) {
    h.plant(doc);
    const r = await h.get('/api/admin/users');
    assert.equal(r.status, 200, what);
    const row = r.body.users.find(u => u.id === VICTIM);
    // "Workouts" is a count of what the drill-down will show, so it is a number, and it does
    // not count entries the sheet drops.
    assert.equal(typeof row.workouts, 'number', `${what}: workouts is a number`);
    assert.equal(row.workouts, Array.isArray(doc.workouts) ? doc.workouts.filter(w => w && typeof w === 'object' && !Array.isArray(w)).length : 0, what);
  }
  // The end state the whole thing is about: the account can be stopped from the dashboard.
  h.plant(DOCS['a null routine entry']);
  const r = await fetch(`${h.api}/api/admin/user/disable`, { method: 'POST', headers: asAdmin, body: JSON.stringify({ id: VICTIM, disabled: true }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find(u => u.id === VICTIM).disabled, true);
  // …and the audit log still reads back, with that change in it.
  const a = await h.get('/api/admin/audit?limit=10&cat=');
  assert.equal(a.status, 200);
  assert.ok(a.body.events.some(e => e.ev === 'admin.user.disable'), JSON.stringify(a.body.events));
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
});

// QA 1.3.9: a profile that only ever pulled (a second device, someone who reads and never edits)
// showed "last sync never" — only a push moved the document's `_ts`. A pull counts too.
test('a pull shows as the last sync, in the list and the drill-down', async t => {
  const h = await startServer(t);
  h.plant({ _rev: 3, workouts: [okW] });
  let row = (await h.get('/api/admin/users')).body.users.find(u => u.id === VICTIM);
  assert.equal(row.lastSync, null);
  const before = Date.now();
  const pull = await fetch(`${h.api}/api/data`, { headers: { Cookie: `gymsid=${mintSession(VICTIM)}` } });
  assert.equal(pull.status, 200);
  row = (await h.get('/api/admin/users')).body.users.find(u => u.id === VICTIM);
  assert.ok(row.lastSync >= before, JSON.stringify(row));
  assert.ok((await h.get(`/api/admin/user?id=${VICTIM}`)).body.lastSync >= before);
  // Kept across a restart: it is on the user record.
  assert.ok(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find(u => u.id === VICTIM).lastPull >= before);
  // A later push still wins when it is the newer of the two.
  h.plant({ _rev: 4, _ts: Date.now() + 60000, workouts: [okW] });
  row = (await h.get('/api/admin/users')).body.users.find(u => u.id === VICTIM);
  assert.ok(row.lastSync > Date.now());
});
