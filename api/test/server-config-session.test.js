/* GET /api/config carries two kinds of fact. The flags the login screen and the pre-login boot
   need (invite_only for the invite field, allow_guest for "continue without account") are public
   — there is nobody to authenticate at the point they are read. The Coach block is not: it names
   the provider this instance talks to, which is exactly what GET /api/coach/disclosure refuses to
   answer without a session. */
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
const UID = 'u_cfg_1';

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-config-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'C', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  // The fixture provider is "connected" by definition (coach/config.js isConnected), which is all
  // publicConfig() needs to produce a block.
  fs.writeFileSync(path.join(dataDir, 'coach.json'), JSON.stringify({ enabled: true, provider: 'fixture' }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '1', ALLOW_GUEST: '0', COACH_DISABLED: '', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  return { api: `http://127.0.0.1:${port}`, dataDir };
}

test('GET /api/config: the login flags are public, the Coach block needs a session', async t => {
  const h = await startServer(t);
  const config = headers => fetch(`${h.api}/api/config`, headers ? { headers } : undefined).then(r => r.json());

  // Nobody signed in — what the login screen and boot() actually read, and nothing else.
  const anon = await config();
  assert.deepEqual(anon, { invite_only: true, allow_guest: false }, 'no coach block for a stranger');

  // A session cookie gets the block, provider and all.
  const signedIn = await config({ Cookie: `gymsid=${mint(UID)}` });
  assert.equal(signedIn.invite_only, true);
  assert.equal(signedIn.allow_guest, false);
  assert.equal(signedIn.coach.enabled, true);
  assert.equal(signedIn.coach.provider, 'fixture');

  // The paired mobile app carries the same token in a header, and boot() reads this route with it.
  const paired = await config({ Authorization: `Bearer ${mint(UID)}` });
  assert.equal(paired.coach.provider, 'fixture');

  // A signature that does not verify is a stranger, not a session.
  const forged = await config({ Cookie: 'gymsid=u_cfg_1:99999999999999:0.notarealmac' });
  assert.deepEqual(forged, { invite_only: true, allow_guest: false });
});

test('a session always gets the key, so the client can tell "no Coach" from "not signed in"', async t => {
  const h = await startServer(t, { COACH_DISABLED: '1' });
  const config = headers => fetch(`${h.api}/api/config`, headers ? { headers } : undefined).then(r => r.json());

  // The client caches this answer for the page load. Without the key it cannot tell an instance
  // with no Coach from an answer made for nobody, and re-asks on every sign-in forever.
  assert.deepEqual(await config({ Cookie: `gymsid=${mint(UID)}` }), { invite_only: true, allow_guest: false, coach: null },
    'signed in, no Coach configured: the key is there and it is null');
  assert.deepEqual(await config(), { invite_only: true, allow_guest: false }, 'and a stranger gets no key at all');
});

test('no Coach configured: no block for anyone, signed in or not', async t => {
  const h = await startServer(t, { COACH_DISABLED: '1' });
  assert.deepEqual(await fetch(`${h.api}/api/config`).then(r => r.json()), { invite_only: true, allow_guest: false });
  const signedIn = await fetch(`${h.api}/api/config`, { headers: { Cookie: `gymsid=${mint(UID)}` } }).then(r => r.json());
  assert.equal(signedIn.coach, null, 'the key says "asked with a session"; null says "no Coach here"');
});
