/* The December push of "Your year in openGym" in a real server (wrapped.js, server.js wrappedTick).
   server.js runs in a child on UTC with its Date.now() driven by test/fake-clock.mjs, and the
   reminder tick shortened to 100 ms, so "Dec 1, 18:05" is a message away. The subscriptions point
   at localhost, which the push agent refuses: the send fails locally and quietly, and the log line
   before it ("wrapped push firing <user> <year>") is what is counted. */
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
const keys = { p256dh: 'p', auth: 'a' };
const created = new Date().toISOString();
const sub = userId => ({ userId, endpoint: `https://localhost/${userId}`, keys, created });
const workouts = d => [{ id: 'w1', d, start: 1, end: 2, entries: [] }];
// Who is who: one owed, and one for every reason not to send.
const PEOPLE = {
  u_owed: { state: { workouts: workouts('2026-03-04'), lang: 'de' } },
  u_off: { state: { workouts: workouts('2026-03-04'), wrappedNotify: false } },
  u_lastyear: { state: { workouts: workouts('2025-11-04') } },
  u_phone: { state: { workouts: workouts('2026-05-04'), wrapped: { phone: 2026 } } },
  u_disabled: { state: { workouts: workouts('2026-05-04') }, user: { disabled: true } },
  u_nosub: { state: { workouts: workouts('2026-05-04') }, nosub: true },
};
const at = iso => Date.parse(iso);
const wait = ms => new Promise(r => setTimeout(r, ms));
// CI sets FORCE_COLOR, so console.log paints the year: strip the colour codes before counting.
const plain = log => log.replace(/\x1b\[[0-9;]*m/g, '');
const firings = (log, uid) => (plain(log).match(new RegExp(`wrapped push firing ${uid} 2026`, 'g')) || []).length;

function seed() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-wrapped-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = Object.entries(PEOPLE).map(([id, p]) => ({ id, name: id, created, ...(p.user || {}) }));
  const subs = Object.entries(PEOPLE).filter(([, p]) => !p.nosub).map(([id]) => sub(id));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs, invites: [] }));
  for (const [id, p] of Object.entries(PEOPLE)) fs.writeFileSync(path.join(dataDir, `state-${id}.json`), JSON.stringify(p.state));
  return dataDir;
}
async function start(t, dataDir) {
  const child = spawn(process.execPath, ['--import', './test/fake-clock.mjs', 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, TZ: 'UTC', PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '100' },
  });
  const h = { child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => child.kill('SIGKILL'));
  await boundPort(child, () => h.log);
  h.at = now => new Promise(resolve => {
    const done = m => { if (m && m.now === now) { child.off('message', done); resolve(); } };
    child.on('message', done);
    child.send({ now });
  });
  h.stop = () => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
  return h;
}

test('Dec 1 from 18:00: one push per user and year, only to whoever is owed one, and never again', async t => {
  const dataDir = seed();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let h = await start(t, dataDir);

  // The afternoon before: nothing.
  await h.at(at('2026-12-01T17:58:00Z'));
  await wait(600);
  assert.doesNotMatch(h.log, /wrapped push firing/, h.log);

  // 18:05: the one who is owed it gets it, once, however many ticks go by.
  await h.at(at('2026-12-01T18:05:00Z'));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !firings(h.log, 'u_owed')) await wait(100);
  await wait(800);
  assert.equal(firings(h.log, 'u_owed'), 1, h.log);
  for (const uid of ['u_off', 'u_lastyear', 'u_phone', 'u_disabled', 'u_nosub']) assert.equal(firings(h.log, uid), 0, uid + '\n' + h.log);
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(db.users.find(u => u.id === 'u_owed').wrappedPush, 2026, 'the year it went out for is on record');
  assert.equal(db.users.find(u => u.id === 'u_off').wrappedPush, undefined);

  // A restart later that evening sends nothing more.
  await h.stop();
  h = await start(t, dataDir);
  await h.at(at('2026-12-01T21:30:00Z'));
  await wait(800);
  assert.equal(firings(h.log, 'u_owed'), 0, h.log);

  // Switching it back on is not a second push this year either way, and the next day is quiet.
  fs.writeFileSync(path.join(dataDir, 'state-u_off.json'), JSON.stringify({ workouts: workouts('2026-03-04') }));
  await h.at(at('2026-12-02T18:30:00Z'));
  await wait(800);
  assert.doesNotMatch(h.log, /wrapped push firing/, h.log);
  assert.equal(h.child.exitCode, null, h.log);
});

test('switched on again before the evening, the opted-out user is owed one after all', async t => {
  const dataDir = seed();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const h = await start(t, dataDir);
  await h.at(at('2026-12-01T19:00:00Z'));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !firings(h.log, 'u_owed')) await wait(100);
  assert.equal(firings(h.log, 'u_off'), 0);
  fs.writeFileSync(path.join(dataDir, 'state-u_off.json'), JSON.stringify({ workouts: workouts('2026-03-04'), wrappedNotify: true, _ts: 2 }));
  const d2 = Date.now() + 15000;
  while (Date.now() < d2 && !firings(h.log, 'u_off')) await wait(100);
  await wait(500);
  assert.equal(firings(h.log, 'u_off'), 1, h.log);
  assert.equal(firings(h.log, 'u_owed'), 1, h.log);
});
