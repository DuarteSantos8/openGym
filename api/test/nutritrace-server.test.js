/* NutriTrace through a real openGym server: the integration routes, the hub, the sealed store, the
 * real transport and net-guard, against a stand-in NutriTrace on 127.0.0.1. The stand-in answers
 * the way NutriTrace's own source does (TraceApps/nutritrace @888c966: middleware/bearer-auth.js
 * 401 auth_missing / auth_invalid, requireScope 403 auth_scope, routes/api/v1/me.js { user,
 * instance, scopes }, routes/api/v1/foods.js `_toWire` { items, total, limit, offset }). It is a
 * stand-in, not NutriTrace: a live instance is still to be checked (docs/ADDONS.md).
 *
 * 127.0.0.1 is reachable only through INTEGRATIONS_ALLOW_LAN plus ALLOWED_PRIVATE_IPS=127.0.0.1, the
 * door server-integrations.test.js uses for its webhook receiver. */
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

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const TOKEN_A = 'nt_pat_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
const TOKEN_B = 'nt_pat_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);
const TOKEN_NO_SCOPE = 'nt_pat_' + crypto.randomBytes(32).toString('base64url').slice(0, 43);

async function startServer(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nt-srv-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_a', name: 'A', created: new Date().toISOString() }, { id: 'u_b', name: 'B', created: new Date().toISOString() }], creds: [], subs: [], invites: [],
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env },
  });
  const h = { log: '', dataDir, bodies: [] };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, body, uid = 'u_a') => {
    const headers = { 'Content-Type': 'application/json', ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}) };
    const r = await fetch(h.api + p, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    h.bodies.push(text);
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: parsed };
  };
  return h;
}

/** A stand-in NutriTrace: tokens → { user, scopes }, and a food library per user. */
async function standIn(t, { tokens, foods }) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push({ path: u.pathname, q: u.searchParams.get('q'), auth: req.headers.authorization });
    const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization || '');
    if (!m) return send(401, { error: 'Token required', code: 'auth_missing' });
    const tok = tokens[m[1]];
    if (!tok) return send(401, { error: 'Invalid token', code: 'auth_invalid' });
    if (u.pathname === '/api/v1/me') return send(200, { user: { id: tok.user, username: 'u' + tok.user, full_name: null, role: 'user' }, instance: { url: 'http://x', version: '1.0.0' }, scopes: tok.scopes });
    if (u.pathname === '/api/v1/foods') {
      if (!tok.scopes.includes('read:foods')) return send(403, { error: 'Token lacks read:foods', code: 'auth_scope' });
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const items = (foods[tok.user] || []).filter(f => f.name.toLowerCase().includes(q));
      return send(200, { items, total: items.length, limit: Number(u.searchParams.get('limit')) || 100, offset: 0 });
    }
    send(404, { error: 'Not found', code: 'not_found' });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: `http://127.0.0.1:${srv.address().port}`, seen };
}

const wire = (id, name, portion, unit, nutrition) => ({ id, name, brand: null, category: null, barcode: null, portion, unit, img_url: '/uploads/secret.jpg', notes: 'private note', nutrition, created_at: '2026-04-12T18:32:11.000Z', updated_at: '2026-04-12T18:32:11.000Z' });

test('end to end: each profile reads only its own NutriTrace, and the token is never given back', async t => {
  const nt = await standIn(t, {
    tokens: { [TOKEN_A]: { user: 1, scopes: ['read:foods'] }, [TOKEN_B]: { user: 2, scopes: ['read:foods'] } },
    foods: { 1: [wire(412, 'Icelandic Skyr, Plain', 100, 'g', { calories: 59, proteins: 11, carbohydrates: 4, fat: 0.2 })], 2: [wire(9, 'Skyr of B', 200, 'g', { calories: 120 })] },
  });
  const h = await startServer(t, { INTEGRATIONS: 'webhook,nutritrace', INTEGRATIONS_ALLOW_LAN: '1', ALLOWED_PRIVATE_IPS: '127.0.0.1' });

  assert.deepEqual((await h.call('GET', '/api/config')).body.integrations.providers, ['webhook', 'nutritrace']);
  assert.equal((await h.call('GET', '/api/integrations/nutritrace/foods?q=skyr', null, null)).status, 401, 'signed out');
  assert.equal((await h.call('GET', '/api/integrations/nutritrace/foods?q=skyr')).status, 404, 'not connected');

  const a = await h.call('POST', '/api/integrations/connect', { provider: 'nutritrace', url: nt.url + '/', token: TOKEN_A });
  assert.equal(a.status, 200);
  const idA = a.body.connection.id;
  assert.deepEqual(a.body.connection.info, { host: new URL(nt.url).host });
  assert.equal('reveal' in a.body, false, 'nothing is shown once: the token is the user\'s own');

  const checked = await h.call('POST', '/api/integrations/test', { id: idA });
  assert.equal(checked.body.ok, true);
  const found = await h.call('GET', '/api/integrations/nutritrace/foods?q=skyr');
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.foods.map(f => [f.name, f.per100.kcal, f.per100.proteinG]), [['Icelandic Skyr, Plain', 59, 11]]);
  assert.ok(!JSON.stringify(found.body).includes('secret.jpg') && !JSON.stringify(found.body).includes('private note'), 'image and notes are not passed on');
  assert.deepEqual(nt.seen.at(-1), { path: '/api/v1/foods', q: 'skyr', auth: 'Bearer ' + TOKEN_A });

  // Profile B: none of A's connection, through any route.
  assert.equal((await h.call('GET', '/api/integrations/nutritrace/foods?q=skyr', null, 'u_b')).status, 404);
  assert.deepEqual((await h.call('GET', '/api/integrations', null, 'u_b')).body.connections, []);
  for (const [m, p, body] of [['POST', '/api/integrations/test', { id: idA }], ['POST', '/api/integrations/update', { id: idA, paused: true }], ['POST', '/api/integrations/disconnect', { id: idA }], ['GET', '/api/integrations/log?id=' + idA]]) {
    assert.equal((await h.call(m, p, body, 'u_b')).status, 404, `${m} ${p} as B`);
  }
  assert.equal((await h.call('GET', '/api/integrations')).body.connections[0].id, idA, 'A\'s connection is still there');

  // B connects its own and sees only its own library.
  await h.call('POST', '/api/integrations/connect', { provider: 'nutritrace', url: nt.url, token: TOKEN_B }, 'u_b');
  assert.deepEqual((await h.call('GET', '/api/integrations/nutritrace/foods?q=skyr', null, 'u_b')).body.foods.map(f => f.name), ['Skyr of B']);
  assert.equal(nt.seen.at(-1).auth, 'Bearer ' + TOKEN_B);

  // The tokens appear in no answer, no server log line and no file on disk.
  await h.call('GET', '/api/integrations/log?id=' + idA);
  const everything = h.bodies.join('\n') + h.log;
  for (const tok of [TOKEN_A, TOKEN_B]) assert.ok(!everything.includes(tok), 'token in an answer or the log');
  const files = fs.readdirSync(path.join(h.dataDir, 'integrations'), { recursive: true }).map(f => path.join(h.dataDir, 'integrations', String(f))).filter(f => fs.statSync(f).isFile());
  const disk = files.map(f => fs.readFileSync(f, 'utf8')).join('');
  assert.ok(!disk.includes('nt_pat_') && !disk.includes(nt.url), 'token and address sealed at rest');
});

test('end to end: a refused token and a missing scope say so, mark the connection, and leak nothing', async t => {
  const nt = await standIn(t, { tokens: { [TOKEN_NO_SCOPE]: { user: 3, scopes: ['write:workouts'] } }, foods: {} });
  const h = await startServer(t, { INTEGRATIONS: 'nutritrace', INTEGRATIONS_ALLOW_LAN: '1', ALLOWED_PRIVATE_IPS: '127.0.0.1' });

  const scoped = (await h.call('POST', '/api/integrations/connect', { provider: 'nutritrace', url: nt.url, token: TOKEN_NO_SCOPE })).body.connection;
  const check = await h.call('POST', '/api/integrations/test', { id: scoped.id });
  assert.equal(check.body.ok, false);
  assert.match(check.body.msg, /read:foods/);
  const s = await h.call('GET', '/api/integrations/nutritrace/foods?q=a');
  assert.equal(s.status, 502);
  assert.equal(s.body.code, 'scope');
  assert.equal((await h.call('GET', '/api/integrations')).body.connections[0].status, 'attention');
  await h.call('POST', '/api/integrations/disconnect', { id: scoped.id });

  const unknown = 'nt_pat_' + 'Z'.repeat(43);
  const bad = (await h.call('POST', '/api/integrations/connect', { provider: 'nutritrace', url: nt.url, token: unknown })).body.connection;
  const r = await h.call('GET', '/api/integrations/nutritrace/foods?q=a');
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'auth');
  assert.match(r.body.error, /refused the token/);
  assert.equal((await h.call('GET', '/api/integrations')).body.connections.find(c => c.id === bad.id).status, 'attention');
  const all = h.bodies.join('\n') + h.log;
  for (const tok of [TOKEN_NO_SCOPE, unknown]) assert.ok(!all.includes(tok));
});

test('end to end: an unreachable NutriTrace is a connection problem, not a token problem', async t => {
  // A port nothing listens on: refused, transient. The token may be fine; the card must not say otherwise.
  const dead = http.createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const port = dead.address().port; await new Promise(r => dead.close(r));
  const h = await startServer(t, { INTEGRATIONS: 'nutritrace', INTEGRATIONS_ALLOW_LAN: '1', ALLOWED_PRIVATE_IPS: '127.0.0.1' });
  const c = (await h.call('POST', '/api/integrations/connect', { provider: 'nutritrace', url: `http://127.0.0.1:${port}`, token: TOKEN_A })).body.connection;
  const check = await h.call('POST', '/api/integrations/test', { id: c.id });
  assert.equal(check.body.ok, false);
  assert.match(check.body.msg, /refused the connection/);
  const s = await h.call('GET', '/api/integrations/nutritrace/foods?q=a');
  assert.equal(s.status, 502);
  assert.equal(s.body.code, 'refused');
  assert.notEqual((await h.call('GET', '/api/integrations')).body.connections[0].status, 'attention', 'a refused connection is not a bad token');
});
