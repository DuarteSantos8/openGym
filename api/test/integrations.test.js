/* The integrations framework (integrations/): sealing, the outbox's idempotency, backoff and
 * rate limits, the log cap, the address rules a webhook URL meets, the signature, and the hub
 * end to end with a fake transport, so nothing here ever leaves the machine. The routes and the
 * PUT /api/data hook are driven through a real server in server-integrations.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { deriveKey, seal, open, signature, verifySignature, newSecret } = await import('../integrations/crypto.js');
const { createStore, LOG_MAX, capRecord } = await import('../integrations/store.js');
const { createOutbox, createBuckets, backoffDelay, BASE_MS, CAP_MS, MAX_ATTEMPTS } = await import('../integrations/outbox.js');
const { detectEvents, eventData, RECENT_MS } = await import('../integrations/events.js');
const { outboundUrlError, outboundAddrOk, isLanAddr, outboundLookup } = await import('../net-guard.js');
const { judge, maskUrl } = await import('../integrations/providers/webhook.js');
const { createIntegrations, enabledIds } = await import('../integrations/index.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-int-'));
const SECRET = 'b'.repeat(64);

/* ---------- sealing ---------- */

test('a sealed value opens with the same key and place only', () => {
  const key = deriveKey(SECRET);
  const s = seal(key, 'https://ha.example.com/api/webhook/abc', 'u1:c1:url');
  assert.match(s, /^v1\./);
  assert.ok(!s.includes('ha.example.com'), 'nothing of the plain text on disk');
  assert.equal(open(key, s, 'u1:c1:url'), 'https://ha.example.com/api/webhook/abc');
  assert.equal(open(key, s, 'u2:c1:url'), null, 'moved to another profile');
  assert.equal(open(key, s, 'u1:c1:secret'), null, 'moved to another field');
  assert.equal(open(deriveKey('c'.repeat(64)), s, 'u1:c1:url'), null, 'another server secret');
  const parts = s.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.equal(open(key, parts.join('.'), 'u1:c1:url'), null, 'tampered');
  assert.notEqual(seal(key, 'x', 'a'), seal(key, 'x', 'a'), 'a fresh nonce every time');
  assert.throws(() => deriveKey(''), /secret/);
});

test('the signature verifies, and refuses another body, secret or an old timestamp', () => {
  const sec = newSecret();
  assert.match(sec, /^ogwh_[A-Za-z0-9_-]{32}$/);
  const body = JSON.stringify({ version: 1, type: 'workout.finished' });
  const ts = Math.floor(Date.now() / 1000);
  const h = signature(sec, body, ts);
  assert.match(h, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature(sec, body, h), true);
  assert.equal(verifySignature(sec, body + ' ', h), false);
  assert.equal(verifySignature(newSecret(), body, h), false);
  assert.equal(verifySignature(sec, body, signature(sec, body, ts - 3600)), false, 'replayed an hour later');
});

/* ---------- the store ---------- */

test('connections are capped on the way in and the log keeps the newest 50', () => {
  const dir = tmp();
  const store = createStore({ dir, key: deriveKey(SECRET) });
  const r = store.add('u1', { id: 'c1', provider: 'webhook', label: 'x'.repeat(500), events: Array(40).fill('e').map((e, i) => e + i), info: { url: 'y'.repeat(5000) }, secrets: { url: 'z'.repeat(9000) }, extra: 'dropped' });
  assert.equal(r.label.length, 60);
  assert.equal(r.events.length, 10);
  assert.equal(r.info.url.length, 200);
  assert.deepEqual(r.secrets, {}, 'an oversized sealed value is not stored');
  assert.equal('extra' in r, false);
  for (let i = 0; i < 80; i++) store.log('u1', 'c1', { ev: 'workout.finished', ok: i % 2 === 0, msg: 'm'.repeat(400) + i });
  const back = store.get('u1', 'c1');
  assert.equal(back.log.length, LOG_MAX);
  assert.ok(back.log.every(e => e.msg.length <= 160));
  // Read back from disk the same way, with the mode a secret-holding file gets.
  const file = path.join(dir, 'u-u1.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const again = createStore({ dir, key: deriveKey(SECRET) }).get('u1', 'c1');
  assert.equal(again.log.length, LOG_MAX);
  store.removeUser('u1');
  assert.equal(fs.existsSync(file), false);
  assert.equal(capRecord({ log: Array(500).fill({ ev: 'x' }) }).log.length, LOG_MAX);
});

/* ---------- the outbox ---------- */

test('backoff doubles from 30 s up to 6 h, with a quarter of jitter either way', () => {
  const mid = () => 0.5, lo = () => 0, hi = () => 0.999999;
  assert.equal(backoffDelay(1, mid), BASE_MS);
  assert.equal(backoffDelay(2, mid), 2 * BASE_MS);
  assert.equal(backoffDelay(3, mid), 4 * BASE_MS);
  assert.equal(backoffDelay(20, mid), CAP_MS);
  assert.equal(backoffDelay(1, lo), 0.75 * BASE_MS);
  assert.ok(backoffDelay(1, hi) <= 1.25 * BASE_MS && backoffDelay(1, hi) > 1.24 * BASE_MS);
});

test('a token bucket lets a burst through, then makes the rest wait their turn', () => {
  let t = 0;
  const b = createBuckets({ now: () => t });
  const lim = { capacity: 3, refillMs: 1000 };
  assert.deepEqual([b.take('k', lim), b.take('k', lim), b.take('k', lim)], [0, 0, 0]);
  assert.equal(b.take('k', lim), 1000);
  assert.equal(b.take('other', lim), 0, 'per key');
  t += 1000;
  assert.equal(b.take('k', lim), 0);
});

function outboxRig(deliver, extra = {}) {
  let t = 1_000_000;
  const file = path.join(tmp(), 'outbox.json');
  const settled = [];
  const ob = createOutbox({ file, deliver, now: () => t, random: () => 0.5, onSettled: (j, r, f) => settled.push({ ev: j.ev, ...r, ...f }), ...extra });
  return { ob, file, settled, tick: ms => { t += ms; }, now: () => t };
}
const job = (key, extra = {}) => ({ id: 'evt_' + key, key, uid: 'u1', conn: 'c1', provider: 'webhook', ev: 'workout.finished', payload: { k: key }, ...extra });

test('one key is delivered once, whoever queues it again and whenever', async () => {
  const sent = [];
  const r = outboxRig(async j => { sent.push(j.key); return { ok: true }; });
  assert.equal(r.ob.enqueue(job('w1')), 'queued');
  assert.equal(r.ob.enqueue(job('w1')), 'duplicate', 'still queued');
  await r.ob.run();
  assert.equal(r.ob.enqueue(job('w1')), 'duplicate', 'already delivered');
  // A restart reads the same file: still a duplicate.
  const again = createOutbox({ file: r.file, deliver: async () => ({ ok: true }), now: r.now });
  assert.equal(again.enqueue(job('w1')), 'duplicate');
  assert.deepEqual(sent, ['w1']);
});

test('a failure is retried on the backoff schedule, a Retry-After wins, and it gives up after the last attempt', async () => {
  const answers = [];
  const r = outboxRig(async () => answers.shift() || { ok: false, retry: true, msg: 'down' });
  r.ob.enqueue(job('w2'));
  answers.push({ ok: false, retry: true, msg: '503' });
  await r.ob.run();
  let j = r.ob.snapshot().jobs[0];
  assert.equal(j.attempts, 1);
  assert.equal(j.nextAt - r.now(), BASE_MS);
  await r.ob.run();
  assert.equal(r.ob.snapshot().jobs[0].attempts, 1, 'not due yet, not tried');
  r.tick(BASE_MS);
  answers.push({ ok: false, retry: true, retryAfterMs: 10 * 60000 });
  await r.ob.run();
  j = r.ob.snapshot().jobs[0];
  assert.equal(j.nextAt - r.now(), 10 * 60000, 'the receiver asked for ten minutes');
  for (let i = 2; i < MAX_ATTEMPTS; i++) { r.tick(CAP_MS); await r.ob.run(); }
  const s = r.ob.snapshot();
  assert.equal(s.jobs.length, 0);
  assert.equal(s.failed.length, 1);
  assert.equal(r.settled.at(-1).final, true);
  // The Retry button brings it back, from attempt 0, and this time it lands.
  answers.push({ ok: true });
  assert.equal(r.ob.retry('u1', 'c1'), 1);
  await r.ob.run();
  assert.equal(r.ob.snapshot().failed.length, 0);
  assert.ok(r.ob.snapshot().done.w2);
});

test('a refusal that will not change is not retried; a deferral spends no attempt', async () => {
  const r = outboxRig(async j => (j.key === 'w3' ? { ok: false, retry: false, msg: '404' } : { defer: 60000 }));
  r.ob.enqueue(job('w3'));
  r.ob.enqueue(job('w4'));
  await r.ob.run();
  const s = r.ob.snapshot();
  assert.deepEqual(s.failed.map(j => j.key), ['w3']);
  assert.equal(s.jobs[0].attempts, 0);
});

test('the outbox rate limit holds jobs back without counting them as failures', async () => {
  let n = 0;
  const r = outboxRig(async () => { n++; return { ok: true }; }, { rateOf: () => [{ key: 'p', capacity: 2, refillMs: 60000 }] });
  for (const k of ['a', 'b', 'c', 'd']) r.ob.enqueue(job(k));
  await r.ob.run();
  assert.equal(n, 2);
  assert.ok(r.ob.snapshot().jobs.every(j => j.attempts === 0));
  r.tick(120000);
  await r.ob.run();
  assert.equal(n, 4);
});

test('the outbox is bounded per profile and drops what a disconnect leaves behind', () => {
  const r = outboxRig(async () => ({ ok: true }));
  for (let i = 0; i < 200; i++) assert.equal(r.ob.enqueue(job('k' + i)), 'queued');
  assert.equal(r.ob.enqueue(job('k200')), 'full');
  assert.equal(r.ob.enqueue(job('big', { uid: 'u2', payload: { x: 'x'.repeat(70000) } })), 'full', 'a payload past 64 KB');
  r.ob.dropConnection('u1', 'c1');
  assert.equal(r.ob.snapshot().jobs.length, 0);
});

/* ---------- where a webhook may go ---------- */

test('webhook URLs: https to the internet only, unless the admin opened the home network', () => {
  for (const u of ['http://example.com/x', 'ftp://example.com', 'https://user:pw@example.com/', 'https://localhost/x', 'https://127.0.0.1/x',
    'https://10.0.0.5/x', 'https://192.168.1.10:8123/api/webhook/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[fd00::1]/x',
    'https://[::ffff:127.0.0.1]/x', 'https://0.0.0.0/', 'not a url', '', 'https://x.com/' + 'a'.repeat(3000)]) {
    assert.ok(outboundUrlError(u), u);
  }
  assert.equal(outboundUrlError('https://hooks.example.com/abc'), null);
  assert.equal(outboundUrlError('https://8.8.8.8/x'), null);
  // INTEGRATIONS_ALLOW_LAN: the home network, over http too, and still never loopback or metadata.
  const lan = { allowLan: true };
  for (const u of ['http://192.168.1.10:8123/api/webhook/x', 'https://10.0.0.5/x', 'http://100.101.102.103/x', 'http://[fd00::1]:1880/x', 'http://homeassistant.lan:8123/x']) {
    assert.equal(outboundUrlError(u, lan), null, u);
  }
  for (const u of ['http://127.0.0.1/x', 'https://169.254.169.254/x', 'http://[::1]/x', 'http://8.8.8.8/x', 'http://0.0.0.0/', 'http://224.0.0.1/']) {
    assert.ok(outboundUrlError(u, lan), u);
  }
  assert.equal(isLanAddr('172.20.1.1'), true);
  assert.equal(isLanAddr('172.32.1.1'), false);
  assert.equal(outboundAddrOk('93.184.216.34', { plain: true, allowLan: true }), false, 'plain http never to the internet');
  assert.equal(outboundAddrOk('93.184.216.34'), true);
});

test('the lookup refuses a name that resolves to a private address (DNS rebinding)', async () => {
  const lookup = outboundLookup({});
  const err = await new Promise(res => lookup('localhost', { all: true }, e => res(e)));
  assert.equal(err?.code, 'EBLOCKED');
  const lanLookup = outboundLookup({ allowLan: true, plain: true });
  const err2 = await new Promise(res => lanLookup('localhost', {}, e => res(e)));
  assert.equal(err2?.code, 'EBLOCKED', 'loopback stays shut with the home network open');
});

test('receiver answers in the outbox\'s words, and the URL is shown masked', () => {
  assert.equal(judge({ status: 204 }).ok, true);
  assert.equal(judge({ status: 500, headers: {} }).retry, true);
  assert.equal(judge({ status: 429, headers: { 'retry-after': '120' } }).retryAfterMs, 120000);
  assert.equal(judge({ status: 404 }).retry, false);
  assert.equal(judge({ status: 302 }).retry, false);
  assert.equal(judge({ status: 410 }).gone, true);
  assert.equal(judge(null, Object.assign(new Error('x'), { code: 'EBLOCKED' })).retry, false);
  assert.equal(judge(null, Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).retry, true);
  assert.equal(maskUrl('https://ha.example.com/api/webhook/opengym-9f8e7d6c5b4a'), 'https://ha.example.com/api/webhook/…5b4a');
  assert.equal(maskUrl('https://ntfy.sh/mytopic'), 'https://ntfy.sh/mytopic');
  assert.equal(maskUrl('https://n8n.example.com/webhook/x?token=abc'), 'https://n8n.example.com/webhook/x?…');
});

/* ---------- events ---------- */

const NOW = Date.parse('2026-10-20T18:00:00Z');
const W = (id, endAgo, extra = {}) => ({ id, d: '2026-10-20', name: 'Push', start: NOW - endAgo - 3600_000, end: NOW - endAgo, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 40, r: 10, done: true, phase: 'warmup' }, { w: 70, r: 5, done: false }] }], prs: [], ...extra });

test('a new recent workout is an event, a record another, an old or edited one is not', () => {
  const prev = { workouts: [W('old', 0)], bodyweight: [{ d: '2026-10-19', w: 80 }] };
  const next = {
    unit: 'kg',
    workouts: [W('old', 0, { name: 'edited' }), W('new', 60000, { prs: ['0025'] }), W('restored', RECENT_MS + 86400_000)],
    bodyweight: [{ d: '2026-10-19', w: 80 }, { d: '2026-10-20', w: 79.6, t: NOW - 1000 }, { d: '2026-01-02', w: 85 }],
  };
  const evs = detectEvents(prev, next, { now: NOW });
  assert.deepEqual(evs.map(e => e.type + ':' + e.entity), ['workout.finished:new', 'workout.pr:new', 'weighin.logged:2026-10-20:79.6']);
  const data = eventData(evs[0], next);
  assert.equal(data.workout.name, 'Push');
  assert.equal(data.workout.exercises[0].name, 'barbell bench press');
  assert.equal(data.workout.exercises[0].sets.length, 2, 'only done sets');
  assert.deepEqual(data.workout.totals, { exercises: 1, sets: 1, reps: 8, volume: 480 }, 'warm-ups ride along but do not count');
  assert.equal(data.workout.durationMin, 60);
  const pr = eventData(evs[1], next);
  assert.deepEqual(pr.records, [{ id: '0025', name: 'barbell bench press', weight: 60, reps: 8 }]);
  assert.deepEqual(eventData(evs[2], next), { weighin: { date: '2026-10-20', weight: 79.6, unit: 'kg' } });
  // A restored backup of hundreds of workouts is not news.
  const lots = { workouts: Array.from({ length: 300 }, (_, i) => W('r' + i, RECENT_MS * 2)) };
  assert.equal(detectEvents({}, lots, { now: NOW }).length, 0);
  assert.equal(detectEvents(null, { workouts: 'nope', bodyweight: [null, 5] }, { now: NOW }).length, 0, 'junk is ignored');
});

/* ---------- the hub ---------- */

function hubRig(env = {}) {
  const dataDir = tmp();
  const calls = [];
  let answer = () => ({ status: 200, headers: {} });
  const transport = async (url, req) => { calls.push({ url, ...req }); const a = answer(); if (a instanceof Error) throw a; return a; };
  let t = NOW;
  const hub = createIntegrations({ dataDir, secret: SECRET, env: { INTEGRATIONS: 'webhook', ...env }, transport, now: () => t });
  return { hub, calls, dataDir, setAnswer: f => { answer = f; }, tick: ms => { t += ms; } };
}

test('INTEGRATIONS decides what exists; unknown names are ignored', () => {
  assert.deepEqual(enabledIds({ INTEGRATIONS: 'webhook, strava ,WEBHOOK' }, ['webhook']), ['webhook']);
  const dataDir = tmp();
  const off = createIntegrations({ dataDir, secret: SECRET, env: {} });
  assert.equal(off.publicConfig(), null);
  assert.deepEqual(off.describe('u1'), { providers: [], connections: [] });
  assert.throws(() => off.connect('u1', 'webhook', { url: 'https://x.example.com/' }), e => e.status === 404);
  assert.equal(off.onStateWrite('u1', {}, { workouts: [W('a', 0)] }), 0);
  assert.equal(fs.existsSync(path.join(dataDir, 'integrations')), false, 'nothing on disk while off');
});

test('connect, deliver signed, fail, retry and disconnect, end to end', async () => {
  const r = hubRig();
  assert.throws(() => r.hub.connect('u1', 'webhook', { url: 'https://192.168.1.4/x' }), e => e.status === 400 && e.code === 'url');
  assert.throws(() => r.hub.connect('u1', 'webhook', { url: 'https://hooks.example.com/a', events: ['nope'] }), e => e.code === 'events');
  const made = r.hub.connect('u1', 'webhook', { url: 'https://hooks.example.com/api/webhook/opengym-1234567890', events: ['workout.finished', 'weighin.logged'] });
  const secret = made.reveal.secret;
  assert.match(secret, /^ogwh_/);
  const id = made.connection.id;
  assert.equal(made.connection.status, 'connected');
  assert.equal(made.connection.info.url, 'https://hooks.example.com/api/webhook/…7890');
  // Nothing secret on disk in the clear, and the app never gets it back.
  const disk = fs.readFileSync(path.join(r.dataDir, 'integrations', 'u-u1.json'), 'utf8');
  assert.ok(!disk.includes(secret) && !disk.includes('opengym-1234567890'));
  assert.ok(!JSON.stringify(r.hub.describe('u1')).includes(secret));

  // A finished workout (after the webhook was added) goes out once, signed.
  r.tick(60000);
  const w = W('w1', -1000, { end: NOW + 30000 });
  // Settings → Modules: Integrations off pauses the hub, nothing is queued, nothing disconnected.
  assert.equal(r.hub.onStateWrite('u1', { workouts: [] }, { workouts: [w], modules: { integrations: false } }), 0);
  assert.equal(r.hub.onStateWrite('u1', { workouts: [] }, { workouts: [w] }), 1);
  assert.equal(r.hub.onStateWrite('u1', { workouts: [] }, { workouts: [w] }), 0, 'the same workout again: no second delivery');
  await r.hub._outbox().run();
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.url, 'https://hooks.example.com/api/webhook/opengym-1234567890');
  assert.equal(c.headers['X-OpenGym-Event'], 'workout.finished');
  assert.equal(verifySignature(secret, c.body, c.headers['X-OpenGym-Signature']), true);
  const body = JSON.parse(c.body);
  assert.equal(body.version, 1);
  assert.equal(body.type, 'workout.finished');
  assert.equal(body.id, c.headers['X-OpenGym-Delivery']);
  assert.equal(body.data.workout.id, 'w1');

  // Not subscribed to records: a PR workout is one delivery, not two.
  r.hub.onStateWrite('u1', { workouts: [w] }, { workouts: [w, W('w2', -2000, { end: NOW + 40000, prs: ['0025'] })] });
  await r.hub._outbox().run();
  assert.deepEqual(r.calls.map(x => x.headers['X-OpenGym-Event']), ['workout.finished', 'workout.finished']);

  // The receiver goes down: logged, retried, and the card says so once it gives up.
  r.setAnswer(() => ({ status: 503, headers: {} }));
  r.hub.onStateWrite('u1', {}, { bodyweight: [{ d: '2026-10-20', w: 80.2, t: NOW + 50000 }] });
  for (let i = 0; i < 8; i++) { await r.hub._outbox().run(); r.tick(7 * 3600_000); }
  let v = r.hub.describe('u1').connections[0];
  assert.equal(v.status, 'attention');
  assert.match(v.lastError.msg, /503/);
  assert.equal(v.failed, 1);
  const log = r.hub.log('u1', id);
  assert.equal(log.log[0].ok, false, 'newest first');
  assert.ok(log.log.length >= 8);

  // Fixed: Retry sends the failed one and clears the warning.
  r.setAnswer(() => ({ status: 200, headers: {} }));
  const back = await r.hub.retry('u1', id);
  assert.equal(back.requeued, 1);
  assert.equal(back.connection.status, 'connected');
  assert.equal(back.connection.failed, 0);

  // Test event: straight through, marked as a test.
  const tst = await r.hub.test('u1', id, 'weighin.logged');
  assert.equal(tst.ok, true);
  assert.equal(JSON.parse(r.calls.at(-1).body).test, true);

  // Another profile cannot see or touch it.
  assert.deepEqual(r.hub.describe('u2').connections, []);
  assert.throws(() => r.hub.disconnect('u2', id), e => e.status === 404);

  // 410: the receiver says it is gone, so it is paused and nothing more is queued for it.
  r.setAnswer(() => ({ status: 410, headers: {} }));
  await r.hub.test('u1', id);
  v = r.hub.describe('u1').connections[0];
  assert.equal(v.paused, true);
  assert.equal(r.hub.onStateWrite('u1', {}, { workouts: [W('w9', -5000, { end: NOW + 99 * 3600_000 })] }), 0);

  r.hub.disconnect('u1', id);
  assert.deepEqual(r.hub.describe('u1').connections, []);
  r.hub.stop();
});

test('at most ten webhooks a profile, and quick taps are slowed down', () => {
  const r = hubRig();
  for (let i = 0; i < 10; i++) r.hub.connect('u1', 'webhook', { url: `https://h${i}.example.com/x` });
  assert.throws(() => r.hub.connect('u1', 'webhook', { url: 'https://h11.example.com/x' }), e => e.status === 409);
  for (let i = 0; i < 9; i++) { try { r.hub.connect('u3', 'webhook', { url: `https://k${i}.example.com/x` }); } catch { /* ten max */ } }
  let limited = false;
  for (let i = 0; i < 30 && !limited; i++) { try { r.hub.update('u3', r.hub.describe('u3').connections[0].id, { label: 'n' + i }); } catch (e) { limited = e.status === 429; } }
  assert.equal(limited, true);
});

test('a connection whose secrets no longer open says so instead of failing quietly', () => {
  const r = hubRig();
  const { connection } = r.hub.connect('u1', 'webhook', { url: 'https://hooks.example.com/x' });
  // The server secret changed (./data/secret replaced): the same files, another key.
  const other = createIntegrations({ dataDir: r.dataDir, secret: 'd'.repeat(64), env: { INTEGRATIONS: 'webhook' }, transport: async () => ({ status: 200 }) });
  const v = other.describe('u1').connections.find(c => c.id === connection.id);
  assert.equal(v.status, 'attention');
  assert.equal(v.lastError.code, 'sealed');
});

test('deleting a profile takes its connections and its queue with it', () => {
  const r = hubRig();
  r.hub.connect('u1', 'webhook', { url: 'https://hooks.example.com/x' });
  r.tick(1000);
  r.hub.onStateWrite('u1', {}, { workouts: [W('w1', -1000, { end: NOW + 5000 })] });
  r.hub.removeUser('u1');
  assert.deepEqual(r.hub.describe('u1').connections, []);
  assert.equal(r.hub._outbox().snapshot().jobs.length, 0);
});
