import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { boundPort } from './helpers.mjs';

const barcode = '3017620422003';
const route = '/api/food-lookup?barcode=' + barcode;
async function start(t, { enabled = '1', mode = 'ok' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-food-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: Array.from({ length: 9 }, (_, i) =>
    ({ id: `u${i}`, name: `Synthetic ${i}`, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }));
  const state = (nutrition, uid = 'u0') => fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({
    modules: nutrition === undefined ? {} : { nutrition }, privateNote: 'SECRET profile data', workouts: []
  }));
  for (let i = 0; i < 9; i++) state(true, `u${i}`);
  const child = spawn(process.execPath, ['--import', './test/food-lookup-transport.mjs', 'server.js'], {
    cwd: new URL('../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: 'http://localhost:8080',
      FOOD_LOOKUP: enabled, FOOD_LOOKUP_CONTACT: '', FOOD_TEST_REPLY: mode, INTEGRATIONS: '', COACH: '',
      AUDIT_LOG: '0' }
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(async () => { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const token = uid => { const p = `${uid}:${Date.now() + 3600000}:0`;
    return p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url'); };
  const call = async (p = route, uid = 'u0', bearer = false, extra = {}) => {
    const headers = { ...extra, ...(uid ? bearer ? { Authorization: 'Bearer ' + token(uid) } : { Cookie: 'gymsid=' + token(uid) } : {}) };
    const r = await fetch(base + p, { headers });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  const outbound = () => {
    const f = path.join(dataDir, 'outbound-test.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse) : [];
  };
  return { call, state, outbound, dataDir, log: () => log };
}
function error(r, status, code) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.code, code); assert.equal(typeof r.body.error, 'string');
  assert.deepEqual(Object.keys(r.body).sort(), ['code', 'error']);
  assert.doesNotMatch(JSON.stringify(r.body), /SECRET|169\.254|upstream body/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
}

test('HTTP signed-out 401 and operator-off 403 have stable codes with zero outbound', async t => {
  const h = await start(t, { enabled: '' });
  error(await h.call(route, null), 401, 'food-lookup-auth-required');
  error(await h.call(), 403, 'food-lookup-disabled');
  assert.equal((await h.call('/api/config', null)).body.foodLookup, undefined);
  assert.deepEqual((await h.call('/api/config')).body.foodLookup, { status: 'disabled' });
  assert.deepEqual(h.outbound(), []);
});

test('HTTP user module requires true, is read from current profile, and fails closed on corrupt state', async t => {
  const h = await start(t);
  for (const value of [undefined, false, null, 'true', 1]) {
    h.state(value); error(await h.call(), 403, 'nutrition-disabled');
  }
  fs.writeFileSync(path.join(h.dataDir, 'state-u0.json'), '{broken');
  error(await h.call(), 403, 'nutrition-disabled');
  assert.deepEqual(h.outbound(), []);
  h.state(true); assert.equal((await h.call()).status, 200);
  h.state(false); error(await h.call(), 403, 'nutrition-disabled');
  assert.equal(h.outbound().length, 1, 'cached result does not bypass current module choice');
});

test('HTTP invalid, duplicate and extra barcode parameters fail before transport', async t => {
  const h = await start(t);
  for (const suffix of ['', '?barcode=bad', '?barcode=3017620422004', '?barcode=96385074%0A',
    '?barcode=' + barcode + '&barcode=96385074', '?barcode=' + barcode + '&url=https://evil.test', '?barcode=%EF%BC%91']) {
    error(await h.call('/api/food-lookup' + suffix), 400, 'food-lookup-invalid-barcode');
  }
  assert.deepEqual(h.outbound(), []);
});

test('HTTP 200 through cookie and bearer sends no personal headers or data and writes no profile', async t => {
  const h = await start(t);
  const before = fs.readFileSync(path.join(h.dataDir, 'state-u0.json'));
  const cfg = await h.call('/api/config');
  assert.deepEqual(cfg.body.foodLookup, { status: 'configured-unverified' });
  assert.deepEqual(h.outbound(), [], 'config is not a connectivity probe');
  const r = await h.call(route, 'u0', false, { 'X-User': 'SECRET', 'User-Agent': 'SECRET client', Authorization: 'Bearer SECRET' });
  assert.equal(r.status, 200); assert.equal(r.body.externalId, barcode);
  assert.deepEqual(r.body.per100, { basis: 'g', proteinG: 5 });
  assert.equal(r.body.attribution.license, 'ODbL-1.0');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await h.call('/api/food-lookup?barcode=036000291452', 'u1', true)).body.externalId, '036000291452');
  const sent = h.outbound(); assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    url: 'https://world.openfoodfacts.org/api/v3.6/product/3017620422003?fields=code,product_name,brands,quantity,serving_size,nutrition',
    method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'openGym/1.4.4' }, agent: false, lookup: 'function'
  });
  assert.doesNotMatch(JSON.stringify(sent), /SECRET|u0|u1|Cookie|Authorization/);
  assert.deepEqual(fs.readFileSync(path.join(h.dataDir, 'state-u0.json')), before);
  assert.deepEqual((await h.call('/api/config')).body.foodLookup, { status: 'configured-unverified' }, 'no stale available claim');
});

test('HTTP unknown product is 404 and a repeated unknown lookup uses the short cache', async t => {
  const h = await start(t, { mode: 'missing' });
  error(await h.call(), 404, 'food-lookup-not-found'); error(await h.call(), 404, 'food-lookup-not-found');
  assert.equal(h.outbound().length, 1);
});

for (const mode of ['error', 'redirect', 'truncated', 'oversized']) {
  test(`HTTP ${mode} provider response is a safe 502`, async t => {
    const h = await start(t, { mode });
    error(await h.call(), 502, 'food-lookup-upstream'); assert.equal(h.outbound().length, 1);
    assert.doesNotMatch(h.log(), /SECRET|169\.254/);
  });
}

test('HTTP stalled upstream body is 504 within the real total deadline', async t => {
  const h = await start(t, { mode: 'stall' });
  error(await h.call(), 504, 'food-lookup-timeout'); assert.equal(h.outbound().length, 1);
});

test('HTTP per-user 429 includes Retry-After while another profile may use the cache', async t => {
  const h = await start(t);
  for (let i = 0; i < 5; i++) assert.equal((await h.call()).status, 200);
  const r = await h.call(); error(r, 429, 'food-lookup-rate-limited');
  assert.ok(+r.headers.get('retry-after') >= 1 && +r.headers.get('retry-after') <= 60);
  assert.equal((await h.call(route, 'u1')).status, 200); assert.equal(h.outbound().length, 1);
});

test('HTTP per-instance 429 reserves budget across users and never sends the eighth request', async t => {
  const h = await start(t, { mode: 'error' });
  for (let i = 0; i < 7; i++) error(await h.call(route, `u${i}`), 502, 'food-lookup-upstream');
  const r = await h.call(route, 'u7'); error(r, 429, 'food-lookup-rate-limited');
  assert.ok(+r.headers.get('retry-after') >= 1 && +r.headers.get('retry-after') <= 61);
  assert.equal(h.outbound().length, 7);
});
