/* "Training now" on the admin dashboard, and the reasons a workout page gives when it sends its
   "left" signal (POST /api/activity { active: false, reason }).

   - `navigated` (in-app route change) and `closed` (pagehide) drop the athlete at once, and so
     does no reason at all, which is what older clients send.
   - `hidden` (the page went to the background) only marks the row. A phone locked between sets
     keeps its keepalive going and that clears the mark, so the athlete never blinks off the
     list; with no keepalive after it (an iOS home-screen app swiped away) the athlete is gone
     270 s after the mark, and at the 5 min expiry after the last sign of life whatever the mark says.
   - A sync (PUT /api/data) that carries a running workout is a sign of life too, so a phone that
     logs sets needs no beat of its own; a sync that carries none (finished, discarded) drops the
     athlete.

   Real server.js in a child, with its Date.now() driven by test/fake-clock.mjs over IPC, so each
   step below happens at an exact server time. */
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
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm_1', ATHLETE = 'u_ath_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' });
const TTL = 300000, GRACE = 270000, KEEPALIVE = 210000;   // the phone's idle keepalive: 3 min, checked every 30 s
const T0 = Math.floor(Date.now() / 1000) * 1000;

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-presence-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
      { id: ATHLETE, name: 'Athlete', created: new Date().toISOString() }
    ], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // The drill-down and the live row with their contents: ADMIN_DATA_VIEW on (off is server-trainers.test.js).
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_DATA_VIEW: 'on' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;

  const post = async body => {
    const r = await fetch(`${api}/api/activity`, { method: 'POST', headers: as(ATHLETE), body: JSON.stringify(body) });
    assert.equal(r.status, 200, log);
  };
  return {
    // Set the server's clock and wait until it has taken.
    at: now => new Promise(resolve => {
      const done = m => { if (m && m.now === now) { child.off('message', done); resolve(); } };
      child.on('message', done);
      child.send({ now });
    }),
    post,
    beat: () => post({ active: true, name: 'Push Day', exIdx: 2, exTotal: 5, setsDone: 7, setsTotal: 16, startedAt: T0 - 600000 }),
    // A device syncs; `active` is the running workout it carries (null: none). `live` is the phone's progress.
    sync: async (active, live, baseRev) => {
      const r = await fetch(`${api}/api/data`, { method: 'PUT', headers: as(ATHLETE), body: JSON.stringify({ state: { workouts: [], routines: [], active }, ...(live ? { live } : {}), ...(baseRev != null ? { baseRev } : {}) }) });
      return r.status;
    },
    left: reason => post(reason === undefined ? { active: false } : { active: false, reason }),
    // The athlete's row as the dashboard gets it: the presence object, or null.
    live: async () => {
      const r = await fetch(`${api}/api/admin/users`, { headers: as(ADMIN) });
      assert.equal(r.status, 200, log);
      return (await r.json()).users.find(u => u.id === ATHLETE).live;
    }
  };
}

test('navigated, closed and no reason at all drop the athlete at once', async t => {
  const h = await startServer(t);
  for (const reason of ['navigated', 'closed', undefined]) {
    await h.at(T0);
    await h.beat();
    assert.ok(await h.live(), `listed before ${reason}`);
    await h.left(reason);
    assert.equal(await h.live(), null, `gone at once after ${reason}`);
  }
});

test('hidden keeps the athlete listed for 270 s after the mark, then drops them', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 5000);
  await h.left('hidden');
  const live = await h.live();
  assert.equal(live.name, 'Push Day', 'still listed right after the mark');
  assert.deepEqual(Object.keys(live).sort(), ['exIdx', 'exTotal', 'name', 'setsDone', 'setsTotal', 'startedAt', 'updatedAt'],
    'the dashboard gets the row it always did, with no mark in it');
  await h.at(T0 + 5000 + GRACE - 1);
  assert.ok(await h.live(), 'listed until the grace is up');
  await h.at(T0 + 5000 + GRACE);
  assert.equal(await h.live(), null, 'gone 270 s after the mark, before the 5 min expiry');
});

test('a keepalive after hidden (a phone locked between sets) clears the mark', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 1000);
  await h.left('hidden');
  await h.at(T0 + 20000);
  await h.beat();
  await h.at(T0 + 1000 + GRACE);
  assert.ok(await h.live(), 'past the grace, still listed: the heartbeat cleared the mark');
  await h.at(T0 + 20000 + TTL - 1);
  assert.ok(await h.live(), 'listed until the expiry after that heartbeat');
  await h.at(T0 + 20000 + TTL);
  assert.equal(await h.live(), null, 'and gone at it');
});

test('the 5 min expiry after the last sign of life applies whatever the hidden mark says', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 60000);
  await h.left('hidden');
  await h.at(T0 + TTL - 1);
  assert.ok(await h.live(), 'listed: inside the grace and inside the expiry');
  await h.at(T0 + TTL);
  assert.equal(await h.live(), null, 'gone at the expiry, with 30 s of the grace left');
});

test('a second hidden with no heartbeat between does not stretch the grace', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 1000);
  await h.left('hidden');
  await h.at(T0 + 20000);
  await h.left('hidden');
  await h.at(T0 + 1000 + GRACE);
  assert.equal(await h.live(), null, 'gone 270 s after the first mark');
});

test('hidden with no row (it arrived after closed) lists nobody', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.left('closed');
  await h.left('hidden');
  assert.equal(await h.live(), null);
});

// The `hidden` beacon and the keepalive go out on different connections, so the beacon can land
// after a keepalive the page sent later than it and mark that fresh row. The page's next keepalive,
// at most 3.5 min on, replaces the row inside the 270 s grace, so an athlete whose page keeps
// beating is listed at every moment, however late in the interval the beacon lands.
test('a hidden that lands after a later keepalive cannot drop an athlete who keeps beating', async t => {
  const h = await startServer(t);
  let base = T0;
  for (const late of [0, 100000, KEEPALIVE - 1]) {
    await h.at(base);
    await h.beat();
    await h.at(base + late);
    await h.left('hidden');                       // lands after the keepalive it raced
    assert.ok(await h.live(), `listed right after a beacon ${late} ms late`);
    for (let s = 10; s <= 2 * KEEPALIVE / 1000; s += 10) {
      await h.at(base + s * 1000);
      if (s * 1000 % KEEPALIVE === 0) await h.beat();
      assert.ok(await h.live(), `listed ${s} s on, with the beacon ${late} ms late`);
    }
    base += 1000000;
  }
});

test('a sync that carries a running workout lists the athlete, with the progress the phone sent', async t => {
  const h = await startServer(t);
  await h.at(T0);
  assert.equal(await h.live(), null);
  assert.equal(await h.sync({ name: 'Push Day', start: T0 - 600000 }, { name: 'Push Day', exIdx: 2, exTotal: 5, setsDone: 7, setsTotal: 16, startedAt: T0 - 600000 }), 200);
  assert.deepEqual(await h.live(), { name: 'Push Day', exIdx: 2, exTotal: 5, setsDone: 7, setsTotal: 16, startedAt: T0 - 600000, updatedAt: T0 });
  await h.at(T0 + TTL - 1);
  assert.ok(await h.live(), 'listed until the expiry');
  await h.at(T0 + TTL);
  assert.equal(await h.live(), null, 'and gone at it');
});

test('a later sync keeps the athlete listed, and a sync from a phone with no `live` still lists the workout by name', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 120000);
  await h.sync({ name: 'Push Day', start: T0 }, { name: 'Push Day', exIdx: 3, exTotal: 5, setsDone: 9, setsTotal: 16, startedAt: T0 });
  await h.at(T0 + TTL + 100000);
  assert.equal((await h.live()).setsDone, 9, 'the sync, not the first beat, set the expiry and the progress');
  await h.at(T0 + 2 * TTL);
  assert.equal(await h.live(), null);
  await h.sync({ name: 'Legs', start: T0 + 5 }, undefined);
  assert.deepEqual(await h.live(), { name: 'Legs', exIdx: 0, exTotal: 0, setsDone: 0, setsTotal: 0, startedAt: T0 + 5, updatedAt: T0 + 2 * TTL });
});

test('a sync that carries no workout (finished or discarded) drops the athlete at once', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.sync({ name: 'Push Day', start: T0 });
  assert.ok(await h.live());
  await h.sync(null);
  assert.equal(await h.live(), null);
});

// Editing a logged workout puts it in `active` too (editingWorkoutId), and the workout screen never
// beats for it: a sync of that edit is nobody training.
test('a sync that carries a past workout being edited lists nobody, and drops a row', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.sync({ name: 'Push Day', start: T0 - 86400000, editingWorkoutId: 'w1' });
  assert.equal(await h.live(), null);
  await h.beat();
  await h.sync({ name: 'Push Day', start: T0 - 86400000, editingWorkoutId: 'w1' });
  assert.equal(await h.live(), null);
});

// Logging a past workout (backfill) is in `active` too, and is nobody training either.
test('a sync that carries a past workout being logged lists nobody, and drops a row', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.sync({ name: 'Push Day', start: T0 - 86400000, backfill: { durationMin: 60, replaceId: null } });
  assert.equal(await h.live(), null);
});

// `{"valueOf":null,"toString":null}` is valid JSON and unary + throws on it. The sync is already
// saved by then, so it must still answer 200; the bad field counts as 0.
test('a progress field that is not a number reads as 0 and never fails the sync or the beat', async t => {
  const h = await startServer(t);
  await h.at(T0);
  const odd = { valueOf: null, toString: null };
  assert.equal(await h.sync({ name: 'Push Day', start: odd }, { setsDone: odd, exIdx: '3' }), 200);
  assert.deepEqual(await h.live(), { name: 'Push Day', exIdx: 3, exTotal: 0, setsDone: 0, setsTotal: 0, startedAt: T0, updatedAt: T0 });
  await h.post({ active: true, name: 'Push Day', exTotal: odd });
  assert.equal((await h.live()).exTotal, 0);
});

test('a refused sync (a conflict) lists nobody', async t => {
  const h = await startServer(t);
  await h.at(T0);
  assert.equal(await h.sync(null), 200);
  assert.equal(await h.sync({ name: 'Push Day', start: T0 }, undefined, 0), 409);
  assert.equal(await h.live(), null);
});
