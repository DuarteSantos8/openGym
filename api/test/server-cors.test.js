/* The paired phone app calls in from its WebView's own origin — https://localhost on Android,
   capacitor://localhost on iOS — so every request it makes with a JSON body or a Bearer token is
   preceded by a CORS preflight. #329 was a proxy in front that answered that preflight itself;
   these pin what openGym's own answer looks like, so a regression here is never the cause.
   Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-cors-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), 'c'.repeat(64), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'https://gym.example.com', RP_ID: 'gym.example.com' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return await boundPort(child, () => log);
}

// node:http, not fetch: the Origin header is the browser's to set, and fetch may refuse it.
function send(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const preflight = (origin, extra = {}) => ({
  Origin: origin,
  'Access-Control-Request-Method': 'POST',
  'Access-Control-Request-Headers': 'content-type',
  ...extra
});

for (const origin of ['https://localhost', 'capacitor://localhost']) {
  test(`the pairing preflight from ${origin} is answered by openGym with that origin allowed`, async t => {
    const port = await startServer(t);
    const r = await send(port, 'OPTIONS', '/api/pair/redeem', preflight(origin));
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], origin);
    assert.match(r.headers['access-control-allow-methods'], /\bPOST\b/);
    assert.match(r.headers['access-control-allow-methods'], /\bPUT\b/);
    const allowed = r.headers['access-control-allow-headers'].toLowerCase().split(/\s*,\s*/);
    assert.ok(allowed.includes('content-type'), allowed.join());
    assert.ok(allowed.includes('authorization'), allowed.join());
    // The phone authenticates with a Bearer token, never the cookie: credentials stay off.
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
    assert.match(String(r.headers.vary), /Origin/);
    assert.equal(r.headers['access-control-allow-private-network'], undefined);

    // The request itself carries the origin back, so the WebView lets the app read the answer.
    const post = await send(port, 'POST', '/api/pair/redeem', { Origin: origin, 'Content-Type': 'application/json' }, JSON.stringify({ code: 'ZZZZ2222' }));
    assert.equal(post.headers['access-control-allow-origin'], origin);
    assert.ok(post.status >= 400 && post.status < 500, String(post.status));
  });
}

test('a preflight that asks for private-network access gets it', async t => {
  const port = await startServer(t);
  const r = await send(port, 'OPTIONS', '/api/pair/redeem', preflight('https://localhost', { 'Access-Control-Request-Private-Network': 'true' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-private-network'], 'true');
});

test('a website on another origin gets no private-network access', async t => {
  const port = await startServer(t);
  const r = await send(port, 'OPTIONS', '/api/pair/redeem', preflight('https://evil.example', { 'Access-Control-Request-Private-Network': 'true' }));
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-private-network'], undefined);
});
