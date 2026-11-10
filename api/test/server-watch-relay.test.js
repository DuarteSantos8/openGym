/* The watch relay end to end (docs/ZEPP_OS.md): a signed-in page asks for a code, the Zepp app's
   Side Service redeems it for a watch token, and page and watch trade a snapshot and events through
   the profile's mailbox. The watch token opens the mailbox and nothing else, and ends with
   "sign out everywhere" and with the account. Real server.js in a child. */
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
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const USERS = [
  { id: 'u_w_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_w_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-watch-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  return h;
}

test('page and watch meet in the mailbox, and only there', async t => {
  const h = await startServer(t);
  const call = async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(h.api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // The page, as a browser tab signed in (same-origin, as the app sends it).
  const page = { Cookie: `gymsid=${mintSession('u_w_1')}`, 'Sec-Fetch-Site': 'same-origin' };

  assert.equal((await call('POST', '/api/watch/pair')).status, 401);
  assert.equal((await call('PUT', '/api/watch/snapshot', { headers: page, body: { json: '{"v":1}' } })).status, 409, 'nothing paired yet');
  assert.equal((await call('POST', '/api/watch/pair', { headers: { ...page, 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'another site cannot mint one');

  const { body: { code } } = await call('POST', '/api/watch/pair', { headers: page });
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // The Side Service: no cookie, no browser headers.
  assert.equal((await call('POST', '/api/watch/redeem', { body: { code: 'AAAA-BBBB-CCCC' } })).status, 400);
  const redeemed = await call('POST', '/api/watch/redeem', { body: { code, name: 'Amazfit Balance' } });
  assert.equal(redeemed.status, 200);
  const { token } = redeemed.body;
  assert.match(token, /^ogw_/);
  assert.equal((await call('POST', '/api/watch/redeem', { body: { code } })).status, 400, 'one-shot');
  assert.ok(!fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8').includes(token), 'only a hash is on disk');

  const watch = { Authorization: 'Bearer ' + token };
  // The watch token is no session.
  assert.equal((await call('GET', '/api/data', { headers: watch })).status, 401);
  assert.equal((await call('GET', '/api/watch/events', { headers: watch })).status, 401);
  assert.equal((await call('GET', '/api/watch/box', { headers: { Authorization: 'Bearer ogw_nope' } })).status, 401);

  assert.deepEqual((await call('GET', '/api/watch/box', { headers: watch })).body, { json: null, at: 0 });
  const snap = JSON.stringify({ v: 1, unit: 'kg', active: { id: 'w-1', name: 'Push', entries: [] }, ready: null });
  assert.equal((await call('PUT', '/api/watch/snapshot', { headers: page, body: { json: snap } })).status, 200);
  assert.equal((await call('PUT', '/api/watch/snapshot', { headers: page, body: { json: 'nope' } })).status, 400);
  assert.equal((await call('GET', '/api/watch/box', { headers: watch })).body.json, snap);

  const events = [
    { id: 'z-1', type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 1, hr: { avg: 120, max: 130 } },
    { id: 'z-2', type: 'finish', wid: 'w-1', at: 2 },
  ];
  const sent = await call('POST', '/api/watch/box', { headers: watch, body: { events } });
  assert.deepEqual(sent.body.accepted, ['z-1', 'z-2']);
  assert.equal(sent.body.json, snap, 'the snapshot rides along');
  const got = await call('GET', '/api/watch/events', { headers: page });
  assert.deepEqual(got.body.events, events);
  assert.equal(got.body.paired, 1);
  // another profile sees none of it
  const other = { Cookie: `gymsid=${mintSession('u_w_2')}`, 'Sec-Fetch-Site': 'same-origin' };
  assert.deepEqual((await call('GET', '/api/watch/events', { headers: other })).body.events, []);

  await call('POST', '/api/watch/ack', { headers: page, body: { ids: ['z-1'] } });
  assert.deepEqual((await call('GET', '/api/watch/events', { headers: page })).body.events.map(e => e.id), ['z-2']);

  const links = (await call('GET', '/api/watch/links', { headers: page })).body.links;
  assert.equal(links.length, 1);
  assert.equal(links[0].name, 'Amazfit Balance');

  // "Sign out everywhere" ends the watch with the sessions.
  assert.equal((await call('POST', '/api/logout/all', { headers: page })).status, 200);
  assert.equal((await call('GET', '/api/watch/box', { headers: watch })).status, 401);
});

test('unpairing the last watch empties the mailbox', async t => {
  const h = await startServer(t);
  const call = async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(h.api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const page = { Cookie: `gymsid=${mintSession('u_w_2')}`, 'Sec-Fetch-Site': 'same-origin' };
  const { body: { code } } = await call('POST', '/api/watch/pair', { headers: page });
  const { body: { token, id } } = await call('POST', '/api/watch/redeem', { body: { code } });
  await call('PUT', '/api/watch/snapshot', { headers: page, body: { json: '{"v":1}' } });
  assert.ok(fs.existsSync(path.join(h.dataDir, 'watch-u_w_2.json')));
  const r = await call('POST', '/api/watch/unlink', { headers: page, body: { id } });
  assert.deepEqual(r.body, { ok: true, links: [] });
  assert.ok(!fs.existsSync(path.join(h.dataDir, 'watch-u_w_2.json')));
  assert.equal((await call('GET', '/api/watch/box', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
});
