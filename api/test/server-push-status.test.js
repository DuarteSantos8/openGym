/* The subscription's server side. The browser keeps its PushSubscription through anything that
   happens here — a row pruned after a dead send, a rebuilt db.json — so the client re-sends it on
   every boot (an upsert that keeps `created`), asks /api/push/status before Settings shows "on",
   and tags it with a device id so a rest-timer alert goes to the device that started the rest.
   Real server.js in a child. */
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

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };
const other = { Cookie: `gymsid=${mintSession('u_test_2')}` };
const keys = { p256dh: 'p', auth: 'a' };

async function startServer(t, subs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pushstatus-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_test_1', name: 'One', created: new Date().toISOString() }, { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }],
    creds: [], subs, invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}
const readDb = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
const post = (h, p, body, hdr = cookie) => fetch(`${h.api}${p}`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const status = (h, endpoint, hdr = cookie) => fetch(`${h.api}/api/push/status?endpoint=${encodeURIComponent(endpoint)}`, { headers: hdr }).then(r => r.json());

test('status tells whether the server holds the endpoint; subscribe is an upsert that keeps created and stores the device id', async t => {
  const h = await startServer(t);
  const endpoint = 'https://push.example/one';
  assert.deepEqual(await status(h, endpoint), { subscribed: false });

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys }, deviceId: 'dev_aaaaaaaa' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_aaaaaaaa' });
  assert.deepEqual(await status(h, endpoint, other), { subscribed: false }, 'another account does not see it');
  const first = readDb(h).subs[0];
  assert.equal(first.deviceId, 'dev_aaaaaaaa');

  await new Promise(r => setTimeout(r, 20));
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'p2', auth: 'a2' } }, deviceId: 'dev_bbbbbbbb' })).status, 200);
  const subs = readDb(h).subs;
  assert.equal(subs.length, 1, 'same endpoint sent again is one row');
  assert.equal(subs[0].created, first.created, 'created survives the re-send');
  assert.equal(subs[0].deviceId, 'dev_bbbbbbbb');
  assert.deepEqual(subs[0].keys, { p256dh: 'p2', auth: 'a2' });

  // a device id that is not a short token is dropped, not stored
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/two', keys }, deviceId: { evil: true } })).status, 200);
  assert.equal('deviceId' in readDb(h).subs.find(s => s.endpoint.endsWith('/two')), false);

  assert.equal((await fetch(`${h.api}/api/push/status?endpoint=x`)).status, 401);
});

// Rows from before device ids, or re-sent by the worker without one, used to stay that way:
// the boot sync saw the endpoint stored and wrote nothing. Status now names the row's device, so
// the owner's browser re-sends the same subscription with its id and the row is repaired in place.
test('a row stored without a device id: status says so, and the owner re-sending it gives it one', async t => {
  const endpoint = 'https://push.example/legacy';
  const browserKeys = { p256dh: 'p-legacy', auth: 'a-legacy' };
  const created = '2025-01-01T00:00:00.000Z';
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint, keys: browserKeys, created }]);

  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: null });
  assert.deepEqual(await status(h, endpoint, other), { subscribed: false }, 'another account does not see it');

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId: 'dev_phone000' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_phone000' });
  assert.deepEqual(readDb(h).subs, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }],
    'one row, the same account, the same keys, its original created, and now a device id');
});

// A re-send with no usable device id used to store the row without one, so a single request with
// a malformed id (or none) made the owner's phone lose its own rest-timer routing. deviceIdOf
// ignores such an id everywhere else (200, not 400), and ignoring it here means keeping the one
// the row already has.
test('a re-send without a usable device id keeps the id the row has', async t => {
  const endpoint = 'https://push.example/kept';
  const browserKeys = { p256dh: 'p-kept', auth: 'a-kept' };
  const created = '2025-03-03T00:00:00.000Z';
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }]);

  for (const deviceId of ['bad!', { evil: true }, undefined]) {
    const r = await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId });
    assert.equal(r.status, 200, `deviceId ${JSON.stringify(deviceId)}`);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(readDb(h).subs, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }],
      `deviceId ${JSON.stringify(deviceId)} leaves the row as it was`);
  }
  // a usable one still replaces it
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId: 'dev_phone001' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_phone001' });
});

test('a rest started on a device whose row has no id rings that row, never another device\'s (#348)', async t => {
  // Same method as the rest-timer test below: every send to localhost fails and is logged.
  const phone = { userId: 'u_test_1', endpoint: 'https://localhost/phone', keys, created: new Date().toISOString() };
  const desk = { userId: 'u_test_1', endpoint: 'https://localhost/desk', keys, deviceId: 'dev_desk0000', created: new Date().toISOString() };
  const h = await startServer(t, [phone, desk]);
  const sent = () => (h.log.match(/push send failed u_test_1/g) || []).length;

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sent(), 1, `no row carries the phone's id: the id-less row (an older client) rings, the desk does not:\n${h.log}`);

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint: phone.endpoint, keys }, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sent(), 2, `after the repair the phone's alert goes to the phone alone:\n${h.log}`);
});

test('another account cannot take over a subscription without its keys; the same browser can', async t => {
  const h = await startServer(t);
  const endpoint = 'https://push.example/victim';
  const browserKeys = { p256dh: 'p-victim', auth: 'a-victim' };
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys } })).status, 200);

  // u_test_2 has learned the endpoint URL, not the keys only the browser (and this server) hold.
  // That used to delete u_test_1's row and file the endpoint under u_test_2: u_test_1's phone
  // went quiet, and got u_test_2's alerts instead, or nothing at all under keys of their choosing.
  const r = await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'p-mine', auth: 'a-mine' } } }, other);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'this subscription belongs to another account' });
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: null }, "the owner's row is untouched");
  assert.deepEqual(readDb(h).subs.map(s => [s.userId, s.keys.auth]), [['u_test_1', 'a-victim']]);

  // A shared browser: u_test_1 signed out (which leaves the push subscription in place), u_test_2
  // signed in, and boot re-registers the same subscription. That browser holds the keys, so the
  // row moves: u_test_1's reminders stop arriving on a device somebody else now uses.
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys } }, other)).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: false });
  assert.deepEqual(await status(h, endpoint, other), { subscribed: true, deviceId: null });
  assert.equal(readDb(h).subs.length, 1);
});

test('a rest timer belongs to the device that set it: another device cancelling does not silence it', async t => {
  // localhost resolves to a loopback address, which PUSH_AGENT refuses — every send fails locally
  // and quietly, and "push send failed" in the log is the proof that a send was attempted.
  const mk = (deviceId, n) => ({ userId: 'u_test_1', endpoint: `https://localhost/${n}`, keys, deviceId, created: new Date().toISOString() });
  const h = await startServer(t, [mk('dev_phone000', 'phone'), mk('dev_desk0000', 'desk')]);
  const sends = () => (h.log.match(/push send failed u_test_1/g) || []).length;

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', { deviceId: 'dev_desk0000' })).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sends(), 1, `the phone's alert went out, to the phone's subscription only:\n${h.log}`);

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', { deviceId: 'dev_phone000' })).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sends(), 1, 'cancelled by its own device: nothing more went out');

  // an older client, no device id: the account-wide behaviour it always had
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1 })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', {})).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sends(), 1, 'legacy cancel clears the legacy timer');
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1 })).status, 200);
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sends(), 3, 'a legacy timer goes to every subscription of the account');
});

// Each rest timer is an hour-long setTimeout and a push when it rings. A new device id per
// request used to leave one more behind every time, without limit.
test('an account keeps at most five rest timers; the oldest give way', async t => {
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint: 'https://localhost/any', keys, created: new Date().toISOString() }]);
  const sent = () => (h.log.match(/push send failed u_test_1/g) || []).length;
  for (let i = 0; i < 8; i++) {
    assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: `dev_cap0000${i}` })).status, 200);
  }
  await new Promise(r => setTimeout(r, 2500));
  assert.equal(sent(), 5, `three were dropped before they rang:\n${h.log}`);
});

test('rest timers and test pushes are throttled per account', async t => {
  const h = await startServer(t);
  let last;
  for (let i = 0; i < 61; i++) last = await post(h, '/api/push/rest-timer', { seconds: 3600, deviceId: 'dev_phone000' });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 3600 }, other)).status, 200, 'another account has its own budget');
  for (let i = 0; i < 10; i++) assert.equal((await post(h, '/api/push/test', {})).status, 200);
  assert.equal((await post(h, '/api/push/test', {})).status, 429);
});

// The URL parser makes `\` a slash and resolves `..`, nginx does not: a path the proxy matched
// as one route must not reach another one here.
test('a path that only normalizes into a route is refused', async t => {
  const h = await startServer(t);
  const net = await import('node:net');
  const raw = p => new Promise((resolve, reject) => {
    const s = net.connect(h.port, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nCookie: ${cookie.Cookie}\r\nConnection: close\r\n\r\n`));
    let out = ''; s.on('data', d => out += d); s.on('end', () => resolve(out.split(' ')[1])); s.on('error', reject);
  });
  assert.equal(await raw('/api/media/..\\data'), '400');
  assert.equal(await raw('/api/media/../data'), '400');
  assert.equal(await raw('/api/x/./../data'), '400');
  assert.equal(await raw('/api/data'), '200');
  assert.equal(await raw('/api/push/status?endpoint=a/../b'), '200');
});

// A browser's cookie and a phone's token are made the same way, and either is accepted in either
// place. Only a phone's token is renewed, or a cookie copied off a browser could be replayed as a
// bearer and traded for a fresh one for as long as anybody liked.
test('GET /api/me renews a phone token past half its life, never a cookie replayed as one', async t => {
  const h = await startServer(t);
  const mint = (kind, daysLeft) => {
    const payload = `u_test_1:${Date.now() + daysLeft * 86400000}:0${kind ? ':' + kind : ''}`;
    return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  };
  const me = async tok => (await fetch(`${h.api}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  assert.ok((await me(mint('b', 10))).token, 'a phone token is renewed');
  assert.ok((await me(mint('', 10))).token, 'a token from before the mark is renewed as before');
  const renewed = (await me(mint('', 10))).token;
  assert.match(Buffer.from(renewed).toString(), /^u_test_1:\d+:0:b\./, 'and comes back as a phone token');
  const cookie = await me(mint('c', 10));
  assert.equal(cookie.user.id, 'u_test_1', 'a cookie still works as a bearer');
  assert.equal(cookie.token, undefined, 'but is not renewed');
  assert.equal((await me(mint('b', 80))).token, undefined, 'nothing is renewed early');
});
