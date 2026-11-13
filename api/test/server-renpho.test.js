/* RENPHO Health end to end: the real server.js in a child, and a stand-in for RENPHO's cloud that
   speaks the same encrypted protocol (api/providers/renpho/client.js). Connect, the first sync, a
   second one that adds nothing, a changed reading that is updated in place, a session RENPHO no
   longer takes, a refused password, two profiles that never see each other's readings, the raw
   copy, and disconnecting. And the second-account way in: a RENPHO friend of the main account
   reads its daily values, and the main account is never signed in to. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { encrypt, decrypt } from '../providers/renpho/client.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const A = 'u_renpho_a', B = 'u_renpho_b';
const PASSWORD_A = 'correct horse battery';

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const session = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });

/* ---- RENPHO's cloud, as far as openGym uses it ---- */
function fakeRenpho() {
  const accounts = {
    'a@example.com': { password: PASSWORD_A, id: '9100000000000000001', rows: [] },
    'b@example.com': { password: 'b-password', id: '9200000000000000002', rows: [] },
  };
  const tokens = new Map();   // token → email
  const f = { accounts, logins: 0, logins_by: {}, trendCalls: 0, server: null, url: '' };
  const reply = (res, obj, code = 101) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code, msg: code === 101 ? 'success' : 'fail', data: obj === undefined ? null : encrypt(JSON.stringify(obj)) }));
  };
  f.expireTokens = () => tokens.clear();
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const plain = decrypt(JSON.parse(body).encryptData);
      // RENPHO since October 2026: without the app's headers the sign-in "cannot be decrypted",
      // and it says so under `message`, not `msg`.
      if (!req.headers.appversion || !req.headers.platform || !req.headers.devid || !req.headers.timezone) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: -114, message: 'Decryption failed' }));
      }
      if (req.url === '/renpho-aggregation/user/login') {
        const { login } = JSON.parse(plain);
        const acc = accounts[login.email];
        if (!acc || acc.password !== login.password) return reply(res, undefined, 30001);
        f.logins++;
        f.logins_by[login.email] = (f.logins_by[login.email] || 0) + 1;
        const token = crypto.randomBytes(8).toString('hex');
        tokens.set(token, login.email);
        // A long id written as a bare number, as RENPHO does.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 101, msg: 'success', data: encrypt(`{"login":{"token":"${token}","id":${acc.id},"weightUnit":1,"password":"must-not-leak"}}`) }));
      }
      const email = tokens.get(req.headers.token);
      if (!email || req.headers.userid !== accounts[email].id) return reply(res, undefined, 40302);
      const acc = accounts[email];
      if (req.url === '/renpho-aggregation/device/count') {
        assert.equal(plain, '');
        return reply(res, { scale: [{ tableName: 'measurements_info_3', count: acc.rows.length, userIds: [acc.id] }] });
      }
      if (req.url === '/RenphoHealth/scale/queryBodyCompositionMeasureData') {
        const q = JSON.parse(plain);
        const page = acc.rows.slice((q.pageNum - 1) * q.pageSize, q.pageNum * q.pageSize);
        // Ids as bare long numbers in the JSON text.
        const text = JSON.stringify(page).replace(/"(id|bUserId)":"(\d+)"/g, '"$1":$2');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 101, msg: 'success', data: encrypt(text) }));
      }
      if (req.url === '/RenphoHealth/app/friend/friendsList') {
        const list = (acc.friends || []).map(e => ({ userId: accounts[e].id, accountName: e.split('@')[0], email: e }));
        return reply(res, { list });
      }
      if (req.url === '/RenphoHealth/app/friend/measure/trendV2') {
        f.trendCalls++;
        const q = JSON.parse(plain);
        const friend = Object.values(accounts).find(a => a.id === q.rhFriendId);
        if (!friend || !(acc.friends || []).some(e => accounts[e] === friend)) return reply(res, undefined, 40001);
        // A month's window ending at endTime (now for 0): each day's last weigh-in, one value.
        const end = q.endTime || Math.floor(Date.now() / 1000);
        const byDay = new Map();
        for (const r of friend.rows.filter(r => r.timeStamp <= end && r.timeStamp > end - 30 * 86400).sort((a, b) => a.timeStamp - b.timeStamp)) {
          byDay.set(r.localCreatedAt.slice(0, 10), r);
        }
        const value = r => q.param === 'muscle' ? Math.round(r.weight * r.muscle) / 100 : r[q.param] ?? 0;
        const list = [...byDay].map(([groupDay, r]) => ({ groupDay, timeStamp: r.timeStamp, value: value(r) }));
        return reply(res, { list });
      }
      reply(res, []);
    });
  });
  return f;
}
const row = (id, owner, ts, weight, more = {}) => ({ id, bUserId: owner, timeStamp: ts, localCreatedAt: new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '), weightUnit: 1, weight, bodyfat: 20, muscle: 45, ...more });

async function startServer(t, renphoUrl) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-renpho-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: A, name: 'Ann', created: new Date().toISOString() }, { id: B, name: 'Bo', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  for (const uid of [A, B]) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({ _ts: 1, _rev: 1, unit: 'kg', health: [], bodyweight: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', RENPHO_BASE_URL: renphoUrl, RENPHO_SYNC_HOURS: '0' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  h.dbText = () => fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8');
  h.rawFile = uid => path.join(dataDir, 'providers', `renpho-${uid}.json`);
  return h;
}
const call = async (h, uid, method, p, body) => {
  const r = await fetch(h.api + p, { method, headers: session(uid), body: body == null ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function synced(h, uid, after = 0) {
  for (let i = 0; i < 100; i++) {
    const s = (await call(h, uid, 'GET', '/api/renpho')).body;
    if (!s.syncing && (s.lastSync || 0) > after) return s;
    if (!s.syncing && s.error && (s.error.at || 0) > after) return s;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('sync did not finish');
}
const renphoRecords = (S, uid) => (S.health || []).filter(r => r.src === 'renpho');

test('RENPHO Health end to end', async t => {
  const f = fakeRenpho();
  await new Promise(r => f.server.listen(0, '127.0.0.1', r));
  t.after(() => f.server.close());
  const url = `http://127.0.0.1:${f.server.address().port}`;
  const ta = 1760000000, A_ID = f.accounts['a@example.com'].id, B_ID = f.accounts['b@example.com'].id;
  f.accounts['a@example.com'].rows = [
    row('9100000000000000101', A_ID, ta, 80, { mysteryField: 'kept', resistance20LeftArm: 300, resistance100LeftArm: 280 }),
    row('9100000000000000102', A_ID, ta + 86400, 79.5),
    // A family member on the same scale: not Ann's.
    row('9100000000000000103', '9100000000000000999', ta + 3600, 55),
  ];
  f.accounts['b@example.com'].rows = [row('9200000000000000201', B_ID, ta, 95)];
  const h = await startServer(t, url);

  // Not connected yet; a wrong password is RENPHO's refusal, and nothing is kept.
  assert.deepEqual((await call(h, A, 'GET', '/api/renpho')).body, { connected: false });
  const bad = await call(h, A, 'POST', '/api/renpho/connect', { email: 'a@example.com', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'auth');
  assert.equal(bad.body.reason, '30001: fail', 'RENPHO\'s own code and words, to say why');
  assert.deepEqual((await call(h, A, 'GET', '/api/renpho')).body, { connected: false });
  assert.equal((await call(h, A, 'POST', '/api/renpho/connect', { email: 'a@example.com' })).status, 400);

  // Connect: the first sync brings the whole history of Ann's readings, grouped per weigh-in.
  const ok = await call(h, A, 'POST', '/api/renpho/connect', { email: 'a@example.com', password: PASSWORD_A });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.connected, true);
  let st = await synced(h, A);
  assert.equal(st.error, null);
  assert.equal(st.lastResult.measurements, 2);
  assert.equal(st.segmental, true);
  assert.ok(st.fields.includes('imp20LeftArm') && st.fields.includes('muscleMass'));
  assert.deepEqual(st.unknown, ['mysteryField']);
  let S = h.state(A);
  let mine = renphoRecords(S, A);
  const first = mine.length;
  assert.ok(first >= 8);
  assert.ok(mine.every(r => r.g === 'renpho:9100000000000000101' || r.g === 'renpho:9100000000000000102'));
  assert.equal(mine.find(r => r.type === 'weight' && r.g.endsWith('101')).v, 80);
  assert.equal(mine.find(r => r.type === 'muscleMass' && r.g.endsWith('101')).v, 36);
  assert.ok(!mine.some(r => r.sid.startsWith('9100000000000000103')), 'a family member\'s reading came in');
  // The weigh-ins land in the body weight log too.
  assert.equal(S.bodyweight.length, 2);

  // Secrets: sealed on the row, never in an answer.
  const dbText = h.dbText();
  assert.ok(!dbText.includes(PASSWORD_A), 'the password is stored readable');
  assert.ok(!JSON.stringify(st).includes('token'));
  assert.ok(!h.log.includes(PASSWORD_A));

  // Sync again: nothing new, nothing doubled.
  const before = st.lastSync;
  assert.equal((await call(h, A, 'POST', '/api/renpho/sync')).status, 200);
  st = await synced(h, A, before);
  assert.equal(st.lastResult.added, 0);
  assert.equal(st.lastResult.updated, 0);
  assert.equal(renphoRecords(h.state(A), A).length, first);

  // A reading changed in RENPHO: updated where it is.
  f.accounts['a@example.com'].rows[1].weight = 79.1;
  const logins = f.logins;
  f.expireTokens();   // and the session RENPHO gave has expired meanwhile
  await call(h, A, 'POST', '/api/renpho/sync');
  st = await synced(h, A, st.lastSync);
  assert.equal(st.error, null);
  assert.equal(f.logins, logins + 1, 'it did not sign in again with the kept password');
  assert.ok(st.lastResult.updated >= 1);
  mine = renphoRecords(h.state(A), A);
  assert.equal(mine.length, first);
  assert.equal(mine.find(r => r.type === 'weight' && r.g.endsWith('102')).v, 79.1);

  // The raw copy keeps every field, the unknown one included, with the provider's facts.
  const raw = (await call(h, A, 'GET', '/api/renpho/raw')).body;
  const m101 = raw.measurements['9100000000000000101'];
  assert.equal(m101.provider, 'renpho');
  assert.equal(m101.external_id, '9100000000000000101');
  assert.equal(m101.external_timestamp, ta * 1000);
  assert.ok(m101.synced_at > 0);
  assert.equal(m101.raw_provider_data.mysteryField, 'kept');
  assert.equal(m101.raw_provider_data.id, '9100000000000000101');

  // A second profile with its own RENPHO account: only its own readings, on either side.
  assert.equal((await call(h, B, 'POST', '/api/renpho/connect', { email: 'b@example.com', password: 'b-password' })).status, 200);
  await synced(h, B);
  const bRecords = renphoRecords(h.state(B), B);
  assert.ok(bRecords.length > 0 && bRecords.every(r => r.g === 'renpho:9200000000000000201'));
  assert.ok(renphoRecords(h.state(A), A).every(r => !r.g.endsWith('201')));
  assert.ok(!JSON.stringify((await call(h, A, 'GET', '/api/renpho/raw')).body).includes('9200000000000000201'));

  // The password changed in RENPHO: the next sync says so, and keeps what came before.
  f.accounts['b@example.com'].password = 'changed';
  f.expireTokens();
  await call(h, B, 'POST', '/api/renpho/sync');
  const sb = await synced(h, B, Date.now() - 1);
  assert.equal(sb.error.code, 'auth');
  assert.equal(sb.error.reason, '30001: fail');
  assert.ok(renphoRecords(h.state(B), B).length > 0);

  // Disconnect: the account and the raw copy are gone; the readings stay in the profile.
  assert.equal((await call(h, A, 'DELETE', '/api/renpho')).status, 200);
  assert.deepEqual((await call(h, A, 'GET', '/api/renpho')).body, { connected: false });
  assert.equal(fs.existsSync(h.rawFile(A)), false);
  assert.equal(renphoRecords(h.state(A), A).length, first);
  assert.ok(!h.dbText().includes('a@example.com'));
});

test('RENPHO through a second account: the friend\'s daily values, and the app stays signed in', async t => {
  const f = fakeRenpho();
  await new Promise(r => f.server.listen(0, '127.0.0.1', r));
  t.after(() => f.server.close());
  const url = `http://127.0.0.1:${f.server.address().port}`;
  const day = 86400, now = Math.floor(Date.now() / 1000);
  const main = f.accounts['a@example.com'];
  f.accounts['tech@example.com'] = { password: 'tech-pass', id: '9300000000000000003', rows: [], friends: [] };
  // Two weigh-ins on one day (the friend pages keep the last), one 3 days back, one 40 days back
  // (the window before), one 200 days back after a long break.
  main.rows = [
    row('9100000000000000301', main.id, now - 3 * day, 81, { bodyfat: 22, muscle: 74, water: 55, bone: 3.2 }),
    row('9100000000000000302', main.id, now - day - 3600, 80.6),
    row('9100000000000000303', main.id, now - day, 80.4, { bodyfat: 21 }),
    row('9100000000000000304', main.id, now - 40 * day, 82),
    row('9100000000000000305', main.id, now - 200 * day, 84),
  ];
  const h = await startServer(t, url);
  const tech = { email: 'tech@example.com', password: 'tech-pass', mode: 'friend', zone: 'Europe/Rome' };

  // No friend yet: said so, nothing kept.
  let r = await call(h, A, 'POST', '/api/renpho/connect', tech);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'no-friend');
  assert.deepEqual((await call(h, A, 'GET', '/api/renpho')).body, { connected: false });

  // Two friends: which one has to be said.
  f.accounts['tech@example.com'].friends = ['b@example.com', 'a@example.com'];
  r = await call(h, A, 'POST', '/api/renpho/connect', tech);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'friend-choice');
  r = await call(h, A, 'POST', '/api/renpho/connect', { ...tech, friendEmail: 'A@example.com ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'friend');
  assert.equal(r.body.friend, 'a@example.com');
  let st = await synced(h, A);
  assert.equal(st.error, null);
  assert.equal(st.lastResult.measurements, 4, 'one per day with a weigh-in, the whole history');
  assert.equal(st.segmental, false);
  const mine = renphoRecords(h.state(A), A);
  const at = (type, d) => mine.find(x => x.type === type && x.d === d)?.v;
  const dayOf = ts => new Date(ts * 1000).toISOString().slice(0, 10);
  assert.equal(at('weight', dayOf(now - day)), 80.4, 'the day\'s last weigh-in');
  assert.equal(mine.filter(x => x.type === 'weight' && x.d === dayOf(now - day)).length, 1);
  assert.equal(at('muscleMass', dayOf(now - 3 * day)), 59.94, 'muscle comes in kg');
  assert.equal(at('boneMass', dayOf(now - 3 * day)), 3.2);
  assert.equal(at('fatMass', dayOf(now - 3 * day)), 17.82);
  assert.equal(at('weight', dayOf(now - 200 * day)), 84, 'a long break is not the start of the history');
  assert.equal(f.logins_by['a@example.com'] || 0, 0, 'the main account was signed in to: its app would be signed out');
  assert.ok(!h.dbText().includes('tech-pass'));

  // Again: nothing new or doubled, and only the last days are asked for.
  const calls = f.trendCalls;
  await call(h, A, 'POST', '/api/renpho/sync');
  st = await synced(h, A, st.lastSync);
  assert.equal(st.lastResult.added, 0);
  assert.equal(st.lastResult.updated, 0);
  assert.ok(f.trendCalls - calls <= 8, `asked ${f.trendCalls - calls} windows for a few days`);
  assert.equal(renphoRecords(h.state(A), A).length, mine.length);
});
