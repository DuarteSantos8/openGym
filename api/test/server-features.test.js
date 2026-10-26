/* Instance features an admin switches off (POST /api/admin/features). Off, a feature is named in
   the public GET /api/config as `features: { qr: false }`; on, the config answers exactly as it
   did before the switch existed. Only an admin may read or change them, and the choice survives a
   restart (it lives in db.json). */
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
const ADMIN = 'u_feat_admin';
const USER = 'u_feat_user';

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function startServer(t, dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: ADMIN, COACH_DISABLED: '1', MEDIA_UPLOADS: '0' }
  });
  t.after(() => child.kill('SIGKILL'));
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  return { api: `http://127.0.0.1:${port}`, child };
}

function dataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-features-'));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [{ id: ADMIN, name: 'A', created: new Date().toISOString() }, { id: USER, name: 'U', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
  }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const as = uid => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' });

test('QR switch: off shows in /api/config, on answers as before, admins only, kept on restart', async t => {
  const dir = dataDir(t);
  let h = await startServer(t, dir);
  const config = () => fetch(`${h.api}/api/config`).then(r => r.json());
  const set = (uid, body) => fetch(`${h.api}/api/admin/features`, { method: 'POST', headers: as(uid), body: JSON.stringify(body) });

  assert.equal((await config()).features, undefined, 'nothing switched off: no block at all');
  assert.deepEqual(await fetch(`${h.api}/api/admin/features`, { headers: as(ADMIN) }).then(r => r.json()), { features: { qr: true } });

  assert.equal((await set(USER, { qr: false })).status, 403, 'not an admin');
  assert.equal((await config()).features, undefined);
  assert.equal((await set(ADMIN, { nope: false })).status, 400);

  const off = await set(ADMIN, { qr: false });
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { features: { qr: false } });
  assert.deepEqual((await config()).features, { qr: false });

  h.child.kill('SIGKILL');
  h = await startServer(t, dir);
  assert.deepEqual((await config()).features, { qr: false }, 'kept in db.json');

  assert.equal((await set(ADMIN, { qr: true })).status, 200);
  assert.equal((await config()).features, undefined, 'back on: the config is as before');
});
