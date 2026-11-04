/* Spotify on the account, through the real server.js in a child: offered only with a Client ID,
   a sign-in address for the profile, a way back that goes only to the app (its own page on this
   instance, or the phone app's link), and a player that says "not connected" in a code the app
   switches on. Spotify's own side (tokens, the player) is in spotify.test.js. */
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
const UID = 'u_music_1';
const CLIENT = 'abcdefabcdefabcdef12';

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const session = () => ({ Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-music-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'https://gym.example.com', RP_ID: 'gym.example.com', ...env }
  });
  const h = { log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}
const call = async (h, method, p, { headers = session(), body } = {}) => {
  const r = await fetch(h.api + p, { method, headers, redirect: 'manual', body: body == null ? undefined : JSON.stringify(body) });
  return { status: r.status, location: r.headers.get('location'), body: await r.json().catch(() => null) };
};
const stateOf = url => new URL(url).searchParams.get('state');

test('without a Client ID the instance says Spotify is not offered here', async t => {
  const h = await startServer(t, { SPOTIFY_CLIENT_ID: '' });
  assert.deepEqual((await call(h, 'GET', '/api/music/spotify')).body, { available: false, connected: false });
  assert.equal((await call(h, 'POST', '/api/music/spotify/connect', { body: {} })).status, 404);
  assert.equal((await call(h, 'GET', '/api/music/spotify/player')).status, 404);
  assert.equal((await call(h, 'GET', '/api/music/spotify', { headers: {} })).status, 401);
});

test('a sign-in address for the profile, and a way back to the app only', async t => {
  const h = await startServer(t, { SPOTIFY_CLIENT_ID: CLIENT });
  const st = (await call(h, 'GET', '/api/music/spotify')).body;
  assert.deepEqual(st, { available: true, connected: false, name: null, redirect: 'https://gym.example.com/api/music/spotify/callback' });

  // A browser: back to its own page on this instance, with the outcome.
  const web = (await call(h, 'POST', '/api/music/spotify/connect', { body: { back: 'https://gym.example.com/' } })).body.url;
  assert.match(web, /^https:\/\/accounts\.spotify\.com\/authorize\?/);
  assert.equal(new URL(web).searchParams.get('client_id'), CLIENT);
  const r1 = await call(h, 'GET', `/api/music/spotify/callback?error=access_denied&state=${stateOf(web)}`, { headers: {} });
  assert.equal(r1.status, 302);
  assert.equal(r1.location, 'https://gym.example.com/?spotify=failed#/settings/features');

  // Somewhere else is never a way back: the instance's own address instead.
  const foreign = (await call(h, 'POST', '/api/music/spotify/connect', { body: { back: 'https://evil.example/' } })).body.url;
  const r2 = await call(h, 'GET', `/api/music/spotify/callback?error=access_denied&state=${stateOf(foreign)}`, { headers: {} });
  assert.equal(r2.location, 'https://gym.example.com/?spotify=failed#/settings/features');

  // The phone app: its own link.
  const app = (await call(h, 'POST', '/api/music/spotify/connect', { body: { app: true } })).body.url;
  const r3 = await call(h, 'GET', `/api/music/spotify/callback?error=access_denied&state=${stateOf(app)}`, { headers: {} });
  assert.equal(r3.location, 'opengym://spotify?failed=1');

  // A state that was used, or never handed out.
  assert.equal((await call(h, 'GET', `/api/music/spotify/callback?code=x&state=${stateOf(app)}`, { headers: {} })).status, 400);
  assert.equal((await call(h, 'GET', '/api/music/spotify/callback?code=x&state=forged', { headers: {} })).status, 400);
});

test('the player before connecting: "auth", and an unknown action is refused', async t => {
  const h = await startServer(t, { SPOTIFY_CLIENT_ID: CLIENT });
  const r = await call(h, 'GET', '/api/music/spotify/player');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'auth');
  assert.equal((await call(h, 'POST', '/api/music/spotify/player', { body: { action: 'volume' } })).status, 400);
  const c = await call(h, 'POST', '/api/music/spotify/player', { body: { action: 'next' } });
  assert.equal(c.status, 409);
  assert.equal(c.body.code, 'auth');
  assert.equal((await call(h, 'DELETE', '/api/music/spotify')).status, 200);
});
