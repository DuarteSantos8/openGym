/* GET /api/nudge-check: what the phone app's background check asks before a missed-day nudge or
   a workout-day reminder it scheduled on itself fires. Whether that day was trained or excused
   elsewhere, whether the server would still nudge it, and the revision: nothing of the workouts
   themselves. Real server.js in a child, the same harness as server-admin-delete.test.js. */
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
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ANA = 'u_ana', BEA = 'u_bea';
// Push every weekday; 2026-09-14 is a Monday.
const everyDay = { 0: 'push', 1: 'push', 2: 'push', 3: 'push', 4: 'push', 5: 'push', 6: 'push' };
const state = {
  _rev: 7, unit: 'kg', routines: [{ id: 'push', name: 'Push Day' }], week: everyDay, dayPlan: {},
  workouts: [{ id: 'w1', d: '2026-09-14', routineId: 'push', start: 1, name: 'Secret session', entries: [{ id: 'bench', sets: [{ w: 100, r: 5 }] }] }],
  dayNotes: { '2026-09-15': { tag: 'sick', _ts: 1 }, '2026-09-16': { _ts: 2 } },
  reminder: { on: true, nudge: true, time: '08:00' },
};

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nudgecheck-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: ANA, name: 'Ana', created: now }, { id: BEA, name: 'Bea', created: now }], creds: [], subs: [], invites: [],
  }));
  fs.writeFileSync(path.join(dataDir, `state-${ANA}.json`), JSON.stringify(state));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.check = async (date, headers = { Authorization: `Bearer ${mintSession(ANA)}` }) => {
    const r = await fetch(`${api}/api/nudge-check${date == null ? '' : '?date=' + encodeURIComponent(date)}`, { headers });
    return { status: r.status, text: await r.text() };
  };
  return h;
}

test('needs a session: a paired phone’s token or a cookie', async t => {
  const h = await startServer(t);
  assert.equal((await h.check('2026-09-14', {})).status, 401);
  assert.equal((await h.check('2026-09-14', { Authorization: 'Bearer nonsense' })).status, 401);
  const cookie = await h.check('2026-09-14', { Cookie: `gymsid=${mintSession(ANA)}` });
  assert.equal(cookie.status, 200);
});

test('a day trained or noted is done; a planned day with nothing is still nudged', async t => {
  const h = await startServer(t);
  const ask = async d => JSON.parse((await h.check(d)).text);
  assert.deepEqual(await ask('2026-09-14'), { date: '2026-09-14', done: true, nudge: false, rev: 7 }, 'a workout');
  assert.deepEqual(await ask('2026-09-15'), { date: '2026-09-15', done: true, nudge: false, rev: 7 }, 'a day note');
  // A cleared note (only a stamp) excuses nothing.
  assert.deepEqual(await ask('2026-09-16'), { date: '2026-09-16', done: false, nudge: true, rev: 7 });
  assert.deepEqual(await ask('2026-09-17'), { date: '2026-09-17', done: false, nudge: true, rev: 7 });
});

test('says nothing of the workouts, and nothing of anyone else', async t => {
  const h = await startServer(t);
  const mine = await h.check('2026-09-14');
  assert.equal(Object.keys(JSON.parse(mine.text)).sort().join(), 'date,done,nudge,rev');
  assert.doesNotMatch(mine.text, /Secret|bench|push|sick/i);
  // Bea has no state at all: nothing done, nothing planned, revision 0. Ana's day stays hers.
  const bea = JSON.parse((await h.check('2026-09-14', { Authorization: `Bearer ${mintSession(BEA)}` })).text);
  assert.deepEqual(bea, { date: '2026-09-14', done: false, nudge: false, rev: 0 });
});

test('a date that is not one is refused', async t => {
  const h = await startServer(t);
  for (const d of [null, '', 'today', '2026-9-14', '2026-13-45', '2026-09-14T00:00']) {
    const r = await h.check(d);
    assert.equal(r.status, 400, String(d));
    assert.equal(JSON.parse(r.text).code, 'date-invalid');
  }
});
