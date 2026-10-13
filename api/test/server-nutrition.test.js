import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

test('Nutrition gateway preserves Node session rules and forwards only credentials', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nutrition-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const mint = (id, exp = Date.now() + 60000, sv = 0) => {
    const payload = `${id}:${exp}:${sv}`;
    return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  };
  fs.writeFileSync(path.join(dir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [
    { id: 'u1', name: 'Илья' }, { id: 'disabled', name: 'Disabled', disabled: true },
    { id: 'revoked', name: 'Revoked', sv: 1 }
  ], creds: [], subs: [], invites: [] }));
  const calls = [];
  let reply = { status: 200, body: { message: 'Hi, Илья!' } };
  const service = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      calls.push({ url: req.url, method: req.method, headers: req.headers, body });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.raw ?? JSON.stringify(reply.body));
    });
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'https://gym.example',
      NUTRITION_URL: `http://127.0.0.1:${service.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(async () => {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    service.closeAllConnections();
    await new Promise(resolve => service.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const hello = headers => fetch(base + '/api/nutrition/hello?name=Mallory', { headers });

  for (const headers of [
    { 'X-User-Name': 'Mallory', 'X-User-Id': 'u1' },
    { Cookie: 'gymsid=forged' },
    { Authorization: 'Bearer ' + mint('u1', Date.now() - 1000) },
    { Authorization: 'Bearer ' + mint('disabled') },
    { Authorization: 'Bearer ' + mint('revoked') },
    { Authorization: 'Bearer ' + mint('missing') },
    { Cookie: `__Host-gymsid=${mint('u1')}; __Host-gymsid=forged` }
  ]) assert.equal((await hello(headers)).status, 401);
  assert.equal(calls.length, 0);

  const token = mint('u1');
  for (const headers of [{ Cookie: `__Host-gymsid=${token}` }, { Authorization: `Bearer ${token}` }]) {
    const r = await hello({ ...headers, 'X-User-Name': 'Mallory', 'X-User-Id': 'admin' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { message: 'Hi, Илья!' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const forwarded = calls.at(-1);
    assert.equal(forwarded.url, '/api/nutrition/hello');
    assert.equal(forwarded.headers['x-user-name'], undefined);
    assert.equal(forwarded.headers['x-user-id'], undefined);
    assert.equal(forwarded.headers.cookie || forwarded.headers.authorization, Object.values(headers)[0]);
  }

  reply = { status: 200, body: { wrong: 'HTML or malformed JSON must not pass as a greeting' } };
  assert.equal((await hello({ Authorization: `Bearer ${token}` })).status, 502);
  reply = { status: 401, body: { error: 'not signed in' } };
  assert.equal((await hello({ Authorization: `Bearer ${token}` })).status, 401);
  reply = { status: 503, body: { error: 'authentication unavailable' } };
  assert.equal((await hello({ Authorization: `Bearer ${token}` })).status, 503);

  const id = 'b8d5423d-a4f6-4759-a3cb-71bd068da786';
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-User-Id': 'admin' };
  reply = { status: 200, body: { products: [], hasMore: false } };
  let response = await fetch(base + '/api/nutrition/products?search=rice%20milk&offset=50&userId=admin', { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), reply.body);
  assert.equal(calls.at(-1).url, '/api/nutrition/products?search=rice+milk&offset=50');
  assert.equal(calls.at(-1).headers['x-user-id'], undefined);
  await fetch(base + '/api/nutrition/diary?date=2026-10-13&userId=admin', { headers: auth });
  assert.equal(calls.at(-1).url, '/api/nutrition/diary?date=2026-10-13');
  for (const [method, route] of [['POST', 'products'], ['POST', 'entries'], ['PUT', 'products/' + id],
    ['PUT', 'entries/' + id], ['DELETE', 'products/' + id], ['DELETE', 'entries/' + id], ['GET', 'entries/' + id]]) {
    const payload = { id, productId: id, quantityGrams: 125, date: '2026-10-13', time: null };
    reply = { status: method === 'POST' ? 201 : 200, body: { id } };
    response = await fetch(base + '/api/nutrition/' + route, { method, headers: auth,
      ...(['POST', 'PUT'].includes(method) ? { body: JSON.stringify(payload) } : {}) });
    assert.equal(response.status, reply.status);
    assert.deepEqual(await response.json(), reply.body);
    assert.equal(calls.at(-1).method, method);
    assert.equal(calls.at(-1).url, '/api/nutrition/' + route);
    if (['POST', 'PUT'].includes(method)) assert.deepEqual(JSON.parse(calls.at(-1).body), payload);
  }
  const before = calls.length;
  assert.equal((await fetch(base + '/api/nutrition/entries', { method: 'POST', headers: { Cookie: `__Host-gymsid=${token}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/nutrition/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/api/nutrition/products', { method: 'POST', headers: auth, body: 'null' })).status, 400);
  assert.equal((await fetch(base + '/api/nutrition/entries', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'x'.repeat(65537) }) })).status, 413);
  assert.equal((await fetch(base + '/api/nutrition/arbitrary', { headers: auth })).status, 404);
  assert.equal(calls.length, before);
  for (const status of [400, 401, 404, 409, 410, 413]) {
    reply = { status, body: { error: 'failure', code: 'invalid_input' } };
    response = await fetch(base + '/api/nutrition/products', { headers: auth });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), reply.body);
  }
  reply = { status: 200, raw: '<html>Not our API</html>' };
  assert.equal((await fetch(base + '/api/nutrition/products', { headers: auth })).status, 502);
  reply = { status: 302, body: {} };
  assert.equal((await fetch(base + '/api/nutrition/products', { headers: auth })).status, 502);
  service.closeAllConnections();
  await new Promise(resolve => service.close(resolve));
  assert.equal((await hello({ Authorization: `Bearer ${token}` })).status, 503);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
