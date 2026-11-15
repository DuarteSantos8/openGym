/* Strava's routes through the real server.js (integrations/routes.js): the sign-in start is a
   redirect to Strava with our state, a callback that is not ours goes back to Settings with the
   reason, and the server says it offers Strava. The token exchange itself is in strava.test.js,
   against a pretend Strava: nothing here leaves the machine. */
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
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const USERS = [
  { id: 'u_t_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_t_2', name: 'Two', created: new Date().toISOString() }
];
const STATE = uid => ({
  _rev: 3, unit: 'kg', weekStart: 1,
  workouts: [{ id: 'w1', d: '2026-11-01', name: uid, start: 1, end: 2, entries: [] }],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }], week: { 1: ['r1'] },
  bodyweight: [{ d: '2026-11-01', w: 80 }], measurements: [{ d: '2026-11-01', waist: 80 }],
  dayPhotos: { ['a'.repeat(64)]: { d: '2026-11-01', m: { hash: 'a'.repeat(64), mime: 'image/jpeg' } } },
  coach: { chat: [{ role: 'user', text: 'private' }] }, customEx: []
});

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-strava-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  for (const u of USERS) fs.writeFileSync(path.join(dataDir, `state-${u.id}.json`), JSON.stringify(STATE(u.id)));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: 'u_t_1', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(h.api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  h.text = async p => { const r = await fetch(h.api + p); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') }; };
  return h;
}
const page = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}`, 'Sec-Fetch-Site': 'same-origin' });
const bearer = tok => ({ Authorization: 'Bearer ' + tok });



const STRAVA = { INTEGRATIONS: 'strava', STRAVA_CLIENT_ID: '4242', STRAVA_CLIENT_SECRET: 'shh', ORIGIN: 'https://gym.example.com' };
const go = (h, p, headers = {}) => fetch(h.api + p, { headers, redirect: 'manual' });

test('the sign-in start sends a signed-in browser to Strava, anyone else back to Settings', async t => {
  const h = await startServer(t, STRAVA);
  const cfg = await h.call('GET', '/api/config', { headers: page('u_t_1') });
  assert.deepEqual(cfg.body.integrations?.providers, ['strava']);
  const r = await go(h, '/api/integrations/oauth/start?provider=strava', page('u_t_1'));
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location'));
  assert.equal(to.host, 'www.strava.com');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://gym.example.com/api/integrations/oauth/callback');
  assert.ok(to.searchParams.get('state'));
  const anon = await go(h, '/api/integrations/oauth/start?provider=strava');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), 'https://gym.example.com/settings/integrations?intg=strava&error=signin');
});

test('a callback that is not ours, or a refusal, goes back with the reason', async t => {
  const h = await startServer(t, STRAVA);
  const bad = await go(h, '/api/integrations/oauth/callback?state=nope&code=x&scope=activity:write', page('u_t_1'));
  assert.equal(bad.status, 302);
  assert.equal(bad.headers.get('location'), 'https://gym.example.com/settings/integrations?intg=strava&error=state');
  // a real state, but the person said no on Strava's page
  const r = await go(h, '/api/integrations/oauth/start?provider=strava', page('u_t_1'));
  const state = new URL(r.headers.get('location')).searchParams.get('state');
  const no = await go(h, '/api/integrations/oauth/callback?state=' + encodeURIComponent(state) + '&error=access_denied', page('u_t_1'));
  assert.match(no.headers.get('location'), /error=denied$/);
  // someone else's state in my browser
  const r2 = await go(h, '/api/integrations/oauth/start?provider=strava', page('u_t_2'));
  const st2 = new URL(r2.headers.get('location')).searchParams.get('state');
  const other = await go(h, '/api/integrations/oauth/callback?state=' + encodeURIComponent(st2) + '&code=x&scope=activity:write', page('u_t_1'));
  assert.match(other.headers.get('location'), /error=state$/);
});

test('without the credentials Strava is not offered', async t => {
  const h = await startServer(t, { INTEGRATIONS: 'strava' });
  const r = await go(h, '/api/integrations/oauth/start?provider=strava', page('u_t_1'));
  assert.match(r.headers.get('location'), /error=off$/);
});
