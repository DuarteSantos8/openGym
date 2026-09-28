/* Two halves of the same rule — a state whose `workouts` or `routines` is not an array must not
   be able to take the api down:
   - PUT /api/data refuses the shape at the door (every real client sends arrays or leaves the
     field out, so nothing legitimate changes);
   - a file that got onto disk anyway is logged and skipped by the reminder tick, which runs
     outside the per-route try/catch, and the users after it still get their reminders.
   Real server.js in a child. The tick runs every 10 s, so the second
   test waits on the log rather than on a fixed sleep. */
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
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };

const USERS = [
  { id: 'u_test_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t, subs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-reminder-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs, invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '300' }
  });
  const h = { api: '', dataDir, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

test('PUT /api/data refuses a state whose workouts or routines is not an array', async t => {
  const h = await startServer(t);
  const put = state => fetch(`${h.api}/api/data`, { method: 'PUT', headers: cookie, body: JSON.stringify({ state }) });
  const file = path.join(h.dataDir, 'state-u_test_1.json');

  for (const bad of [{ workouts: {} }, { workouts: 'abc' }, { workouts: 7 }, { workouts: true }, { routines: {} }, { routines: 'r1' }, { workouts: [], routines: {} }]) {
    const r = await put({ _ts: 1, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual(await r.json(), { error: 'invalid state' }, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(file), false, 'nothing landed on disk');

  // the shapes real clients send still go through: arrays, the field left out, or null.
  // (Something of the profile has to be in there — a document that is only `_ts`/`_rev` is the
  // empty push the route refuses, so the "left out" case carries a real key of its own.)
  assert.equal((await put({ _ts: 2, workouts: [], routines: [] })).status, 200);
  assert.equal((await put({ _ts: 3, unit: 'kg' })).status, 200);
  assert.equal((await put({ _ts: 4, workouts: null, routines: null })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))._ts, 4);
});

test('a non-array workouts on disk is logged and skipped by the reminder tick; the next user still fires', async t => {
  const keys = { p256dh: 'p', auth: 'a' };
  // localhost resolves to a loopback address, which PUSH_AGENT refuses — the send that follows the
  // reminder fails locally and quietly, with no socket leaving this machine
  const subs = USERS.map(u => ({ userId: u.id, endpoint: 'https://localhost/x', keys, created: new Date().toISOString() }));
  const h = await startServer(t, subs);

  const routines = [{ id: 'r1', name: 'Full body', emoji: '💪', ex: [] }];
  const week = { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' };
  // hh:mm exactly the way server.js userNow() derives it, so the reminder is "now" in UTC
  const nowHHMM = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
    const g = type => parts.find(p => p.type === type)?.value;
    return `${g('hour')}:${g('minute')}`;
  };
  // The tick re-reads each state file every pass and only acts when the reminder is for the
  // current minute, so both files are rewritten with "now" until the log shows the tick has done
  // its work — a minute rolling over mid-wait cannot make it miss.
  const seed = () => {
    const reminder = { on: true, time: nowHHMM(), tz: 'UTC' };
    fs.writeFileSync(path.join(h.dataDir, 'state-u_test_1.json'), JSON.stringify({ reminder, routines, week, workouts: {} }));
    fs.writeFileSync(path.join(h.dataDir, 'state-u_test_2.json'), JSON.stringify({ reminder, routines, week, workouts: [] }));
  };
  const done = () => /reminder tick u_test_1/.test(h.log) && /reminder firing u_test_2 r1/.test(h.log);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !done() && h.child.exitCode === null) {
    seed();
    await new Promise(r => setTimeout(r, 500));
  }

  assert.equal(h.child.exitCode, null, `server exited:\n${h.log}`);
  assert.match(h.log, /reminder tick u_test_1 TypeError/, h.log);
  assert.match(h.log, /reminder firing u_test_2 r1/, h.log);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.ok(db.users.find(u => u.id === 'u_test_2').lastReminder, 'the good user\'s reminder was recorded');
});

/* The catch-up window. The tick used to want the exact minute — an API restart or a stalled
   tick across those 60 s lost the whole day's reminder. A reminder is now owed for 15 minutes
   after its time, once per local date, and not later than that. */
const hhmmMinusMinutes = m => {
  const d = new Date(Date.now() - m * 60000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = type => parts.find(p => p.type === type)?.value;
  return { hhmm: `${g('hour')}:${g('minute')}`, sameDay: d.getUTCDate() === new Date().getUTCDate() };
};
const goodState = (time, over = {}) => JSON.stringify({
  reminder: { on: true, time, tz: 'UTC' },
  routines: [{ id: 'r1', name: 'Full body', emoji: '💪', ex: [] }],
  week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' },
  workouts: [], ...over
});
const sub = { userId: 'u_test_1', endpoint: 'https://localhost/x', keys: { p256dh: 'p', auth: 'a' }, created: new Date().toISOString() };
const firings = log => (log.match(/reminder firing u_test_1 r1/g) || []).length;
const wait = ms => new Promise(r => setTimeout(r, ms));

test('a reminder whose minute passed 3 minutes ago still fires — once', async t => {
  const late = hhmmMinusMinutes(3);
  if (!late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const h = await startServer(t, [sub]);
  fs.writeFileSync(path.join(h.dataDir, 'state-u_test_1.json'), goodState(late.hhmm));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !firings(h.log)) await wait(300);
  assert.equal(firings(h.log), 1, h.log);
  // several more ticks: the date-level dedupe holds inside the window
  await wait(1500);
  assert.equal(firings(h.log), 1, 'fired again inside the window');
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.ok(db.users.find(u => u.id === 'u_test_1').lastReminder, 'the day is recorded');
});

test('a reminder 20 minutes past is not delivered late, and a day already trained is skipped', async t => {
  const stale = hhmmMinusMinutes(20);
  const late = hhmmMinusMinutes(2);
  if (!stale.sameDay || !late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const h = await startServer(t, [sub]);
  const file = path.join(h.dataDir, 'state-u_test_1.json');
  fs.writeFileSync(file, goodState(stale.hhmm));
  await wait(1500);   // several ticks
  assert.equal(firings(h.log), 0, `20 minutes late must stay silent:\n${h.log}`);
  // inside the window but today's workout is already logged
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  fs.writeFileSync(file, goodState(late.hhmm, { workouts: [{ id: 'w1', d: today }] }));
  await wait(1500);
  assert.equal(firings(h.log), 0, `a trained day must stay silent:\n${h.log}`);
});

/* A null entry inside an otherwise fine list is not a shape the tick can refuse at the door:
   PUT /api/data drops those now, but a file written before it did still has them, and the tick
   walks both lists (`w.d`, `r.id`). It threw on the first entry and skipped the user — every
   day, silently, for as long as the file stayed that way. The entries are skipped; the reminder
   is not. */
test('a null entry in workouts or routines does not cost that profile its reminder', async t => {
  const late = hhmmMinusMinutes(2);
  if (!late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const h = await startServer(t, [sub]);
  fs.writeFileSync(path.join(h.dataDir, 'state-u_test_1.json'), goodState(late.hhmm, {
    workouts: [null, { id: 'w1', d: '2026-01-01' }],
    routines: [null, { id: 'r1', name: 'Full body', emoji: '💪', ex: [] }]
  }));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !firings(h.log)) await wait(300);
  assert.equal(firings(h.log), 1, h.log);
  assert.doesNotMatch(h.log, /reminder tick u_test_1 TypeError/, h.log);
});
