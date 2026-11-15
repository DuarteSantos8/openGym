/* The profile picture (frontend lib/avatar.js) on a real server.js: it is an ordinary file of the
   profile's media store, named by its hash, with only `avatar.m` in the state. What is under test
   is who can get at it (the account itself, and nobody else: not another user, not an admin, not
   an admin's views of the profile), that the image caps apply to it, that the sweep keeps it while
   the state names it, and that an instance with uploads off neither takes it nor offers it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ANA = 'u_av_ana', BO = 'u_av_bo', ADMIN = 'u_av_adm';
const cookie = uid => ({ Cookie: `gymsid=${mint(uid)}`, Origin: ORIGIN });
const bearer = uid => ({ Authorization: `Bearer ${mint(uid)}` });
const avatarState = (hash, size) => ({
  unit: 'kg', routines: [], workouts: [],
  avatar: { m: { kind: 'image', hash, mime: 'image/webp', size, width: 256, height: 256, at: 1 } }
});

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-avatar-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ANA, name: 'Ana', created: new Date().toISOString() },
      { id: BO, name: 'Bo', created: new Date().toISOString() },
      { id: ADMIN, name: 'Admin', created: new Date().toISOString(), admin: true }
    ],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', MEDIA_MIN_FREE_MB: '1', ADMIN_UIDS: ADMIN, ...env }
  });
  const h = { log: '', dataDir, uploads: path.join(dataDir, 'uploads') };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.put = (bytes, { uid = ANA, declare = 'image/webp', hash = M.sha(bytes) } = {}) =>
    fetch(`${h.api}/api/media/${hash}`, { method: 'PUT', headers: { ...cookie(uid), 'Content-Type': declare }, body: bytes });
  h.get = (hash, headers) => fetch(`${h.api}/api/media/${hash}`, { headers });
  h.pushState = (state, uid = ANA) => fetch(`${h.api}/api/data`, { method: 'PUT', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
  return h;
}

test('a profile picture is the account\'s alone: not another user\'s, not an admin\'s, not in the admin views', async t => {
  const h = await start(t);
  const pic = M.webp(12000);
  const hash = M.sha(pic);
  assert.equal((await h.put(pic)).status, 201);
  assert.equal((await h.pushState(avatarState(hash, pic.length))).status, 200);

  // The account itself, by cookie and by a paired phone's bearer token.
  const own = await h.get(hash, cookie(ANA));
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  assert.ok(Buffer.from(await own.arrayBuffer()).equals(pic));
  assert.equal((await h.get(hash, bearer(ANA))).status, 200);

  // Anyone else who knows (or guesses) the hash gets exactly what a hash nobody uploaded gets.
  const nobody = await h.get('f'.repeat(64), cookie(BO));
  for (const who of [cookie(BO), bearer(BO), cookie(ADMIN), bearer(ADMIN)]) {
    const r = await h.get(hash, who);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), await (await h.get('f'.repeat(64), cookie(BO))).json());
  }
  assert.equal(nobody.status, 404);
  assert.equal((await h.get(hash, { Origin: ORIGIN })).status, 401);

  // Another user uploading the same bytes learns nothing about Ana's copy: a fresh file of theirs.
  const again = await h.put(pic, { uid: BO });
  assert.equal(again.status, 201);
  assert.equal((await again.json()).existed, false);

  // The admin's user list and drill-down carry no trace of the picture.
  const list = await fetch(`${h.api}/api/admin/users`, { headers: cookie(ADMIN) });
  assert.equal(list.status, 200);
  const one = await fetch(`${h.api}/api/admin/user?id=${ANA}`, { headers: cookie(ADMIN) });
  assert.equal(one.status, 200);
  for (const body of [await list.text(), await one.text()]) {
    assert.ok(!body.includes(hash), 'the admin views must not name the picture');
    assert.ok(!/avatar/i.test(body), 'the admin views must not carry the avatar field');
  }
});

test('the image caps apply to a profile picture, and the sweep keeps it while the state names it', async t => {
  const h = await start(t, { MEDIA_IMAGE_MAX_MB: String(40000 / 1048576), MEDIA_GC_GRACE_DAYS: '0' });
  const big = M.webp(60000);
  const r = await h.put(big);
  assert.equal(r.status, 413);
  assert.equal((await r.json()).code, 'media-too-large');
  // Not an image at all, declared as one: refused for what it is.
  const html = M.html();
  const bad = await h.put(html, { declare: 'image/webp' });
  assert.equal(bad.status, 415);

  const pic = M.webp(9000);
  const hash = M.sha(pic);
  assert.equal((await h.put(pic)).status, 201);
  assert.equal((await h.pushState(avatarState(hash, pic.length))).status, 200);
  const sweep = await fetch(`${h.api}/api/media/sweep`, { method: 'POST', headers: { ...cookie(ANA), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(sweep.status, 200);
  assert.equal((await h.get(hash, cookie(ANA))).status, 200);
  const cfg = await (await fetch(`${h.api}/api/config`)).json();
  assert.equal(cfg.media.avatar, true);
});

test('with MEDIA_UPLOADS=0 the server neither offers nor takes a picture, and the state keeps only the hash', async t => {
  const h = await start(t, { MEDIA_UPLOADS: '0' });
  const cfg = await (await fetch(`${h.api}/api/config`)).json();
  assert.equal(cfg.media, undefined);
  const pic = M.webp(9000);
  assert.equal((await h.put(pic)).status, 404);
  const hash = M.sha(pic);
  assert.equal((await h.pushState(avatarState(hash, pic.length))).status, 200);
  const data = await (await fetch(`${h.api}/api/data`, { headers: cookie(ANA) })).json();
  assert.equal(data.state.avatar.m.hash, hash);
  assert.equal(fs.existsSync(path.join(h.uploads, ANA)), false);
});
