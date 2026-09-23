/* The admin routes read state files nobody validated. PUT /api/data drops null and shapeless
   entries and refuses a non-array `workouts`/`routines` (QA C16/C19), but a document written
   before it did still sits on disk and answers to nobody — and every one of these routes walks
   those lists and dereferences what it finds. One throw is a 500 for the whole drill-down: the
   sheet never leaves "Loading…", and the Disable button lives inside that sheet, so the account
   an operator opened the dashboard to stop stays un-disableable. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const ADMIN = 'u_adm_1', VICTIM = 'u_vic_1';
const asAdmin = { Cookie: `gymsid=${mintSession(ADMIN)}`, 'Content-Type': 'application/json' };

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
      { id: VICTIM, name: 'Mallory', created: new Date().toISOString() }
    ], creds: [], subs: [], invites: []
  }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(up, `server never came up:\n${h.log}`);
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
