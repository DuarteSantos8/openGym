/* The missed-workout nudge, end to end through the real reminder tick (server.js in a child,
   REMINDER_TICK_MS shortened). The nudge is owed from 20:00 to 21:30 on the user's clock, so
   instead of faking the time each test picks the zone where it is 20:xx right now — which also
   makes every test a timezone test: the server's own clock is never 20:xx by assumption.
   nudge.test.js covers the rules themselves (back-off, coach week, copy). */
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
const UID = 'u_nudge_1';
const USERS = [{ id: UID, name: 'One', created: new Date().toISOString() }];
const sub = { userId: UID, endpoint: 'https://localhost/x', keys: { p256dh: 'p', auth: 'a' }, created: new Date().toISOString() };

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

async function startServer(t, subs = [sub]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nudge-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs, invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '200' }
  });
  const h = { dataDir, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.write = state => fs.writeFileSync(path.join(dataDir, 'state-' + UID + '.json'), JSON.stringify(state));
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return h;
}

// An Etc/GMT zone whose local hour is `hour` right now (POSIX sign: Etc/GMT-5 is UTC+5).
function zoneAt(hour) {
  let off = (hour - new Date().getUTCHours() + 48) % 24;
  if (off > 14) off -= 24;
  return off === 0 ? 'UTC' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}
const dateIn = (tz, ms = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const daysAgo = (tz, n) => dateIn(tz, Date.now() - n * 86400000);

const routines = [{ id: 'r1', name: 'Push Day', emoji: '💪', ex: [] }];
const everyDay = { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' };
// Trained yesterday, today planned and not logged: a missed day, nothing to back off from.
const missedToday = (tz, over = {}) => ({
  reminder: { on: true, time: '08:00', tz, nudge: true, tone: 'drill' },
  routines, week: everyDay, workouts: [{ id: 'w1', d: daysAgo(tz, 1), routineId: 'r1' }], ...over
});
const firings = log => (log.match(new RegExp(`nudge firing ${UID} r1`, 'g')) || []).length;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !pred()) await wait(100);
}

test('fires once on the evening of a missed planned day, in the user\'s zone', async t => {
  const tz = zoneAt(20);
  const h = await startServer(t);
  h.write(missedToday(tz));
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
  await wait(1200);  // several more ticks: once per local date
  assert.equal(firings(h.log), 1, 'fired twice in one evening');
  assert.equal(h.db().users[0].lastNudge, dateIn(tz));
  // the plain reminder (08:00 there) is long past its window and stays out of it
  assert.doesNotMatch(h.log, /reminder firing/);
});

test('silent outside the evening, on a rest day, on a trained day, and when switched off', async t => {
  const h = await startServer(t);
  const eve = zoneAt(20);
  const cases = [
    ['morning in that zone', missedToday(zoneAt(10))],
    ['22:00 in that zone, past 21:30', missedToday(zoneAt(22))],
    ['rest day', missedToday(eve, { week: {} })],
    ['rest override today', missedToday(eve, { dayPlan: { [dateIn(eve)]: 'rest' } })],
    ['workout logged today', missedToday(eve, { workouts: [{ id: 'w2', d: dateIn(eve), routineId: 'r1' }] })],
    ['nudge off', missedToday(eve, { reminder: { on: true, time: '08:00', tz: eve, nudge: false } })],
    ['reminder off', missedToday(eve, { reminder: { on: false, time: '08:00', tz: eve, nudge: true } })],
    ['reminder too late for an evening nudge', missedToday(eve, { reminder: { on: true, time: '20:00', tz: eve, nudge: true } })],
    ['back-off: 3 missed days in a row already', missedToday(eve, { workouts: [{ id: 'w0', d: daysAgo(eve, 4), routineId: 'r1' }] })],
  ];
  for (const [name, state] of cases) {
    h.write(state);
    await wait(700);
    assert.equal(firings(h.log), 0, `${name}:\n${h.log}`);
  }
  assert.equal(h.db().users[0].lastNudge, undefined);
  // …and the same server does fire once the day really is a missed one
  h.write(missedToday(eve));
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
});

test('no push subscription, or a workout on screen right now: no nudge', async t => {
  const tz = zoneAt(20);
  const bare = await startServer(t, []);
  bare.write(missedToday(tz));
  await wait(1000);
  assert.equal(firings(bare.log), 0, bare.log);

  const h = await startServer(t);
  const live = await fetch(`${h.api}/api/activity`, {
    method: 'POST', headers: { Cookie: `gymsid=${mintSession(UID)}` },
    body: JSON.stringify({ active: true, name: 'Push Day', startedAt: Date.now() })
  });
  assert.equal(live.status, 200);
  h.write(missedToday(tz));
  await wait(1000);
  assert.equal(firings(h.log), 0, `a session is under way:\n${h.log}`);
  // the session ends without a workout being saved: the nudge is owed again
  await fetch(`${h.api}/api/activity`, { method: 'POST', headers: { Cookie: `gymsid=${mintSession(UID)}` }, body: JSON.stringify({ active: false }) });
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
});
