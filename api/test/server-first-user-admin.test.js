/* FIRST_USER_ADMIN (#328): the first profile made on an instance with no profiles becomes its
   admin, through either way of registering. Never retroactive — an instance that already has
   profiles changes nothing. Off unless FIRST_USER_ADMIN=1. Real server.js in a child, the
   same harness as server-passkeys.test.js. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../password.js';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const b64u = b => Buffer.from(b).toString('base64url');
const sha = b => crypto.createHash('sha256').update(b).digest();

const mintSession = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

// Just enough CBOR for an attestation object: a map of text keys to text, bytes or an empty map.
const cborHead = (major, n) => n < 24 ? Buffer.from([(major << 5) | n])
  : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cborText = s => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cborBytes = b => Buffer.concat([cborHead(2, b.length), b]);

function softPasskey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')
  ]);
  const raw = crypto.randomBytes(16);
  const id = b64u(raw);
  let counter = 0;
  return {
    id,
    row: (userId, extra = {}) => ({ id, userId, publicKey: cose.toString('base64url'), counter: 0, transports: ['internal'], ...extra }),
    // What navigator.credentials.create() hands back, serialised the way lib/api.js does.
    attestation(challenge, { origin = ORIGIN } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const len = Buffer.from([raw.length >> 8, raw.length & 255]);
      const authData = Buffer.concat([sha('localhost'), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, raw, cose]);
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]),
        cborText('authData'), cborBytes(authData)
      ]);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] }
      };
    },
    assertion(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter);
      const authData = Buffer.concat([sha('localhost'), Buffer.from([0x05]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }
      };
    }
  };
}

const GOOD = 'correct horse battery staple';
let pwHash;
// Made before any test runs: withPassword() reads it while a test's arguments to startServer are
// still being built, so a test run on its own would otherwise give its user no hash at all.
before(async () => { pwHash ??= await hashPassword(GOOD); });

async function startServer(t, { env = {}, users = [], creds = [], deviceLinks } = {}) {
  pwHash ??= await hashPassword(GOOD);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-fa-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites: [], ...(deviceLinks ? { deviceLinks } : {}) }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost',
      PASSWORD_LOGIN: '1', TRUST_PROXY: '1', INVITE_ONLY: '', ADMIN_UIDS: '', AUDIT_LOG: '1', ...env
    }
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.req = async (method, p, { body, cookie, ip = '198.51.100.1', headers = {} } = {}) => {
    const r = await fetch(`${h.api}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = r.headers.getSetCookie().find(c => c.startsWith('gymsid=') && !c.startsWith('gymsid=;'));
    return { status: r.status, body: await r.json(), headers: r.headers, cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  // A passkey assertion made for this request, the way Settings confirms before adding.
  h.stepUp = async (key, ip) => {
    const { cid, options } = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
    return { cid, credential: key.assertion(options.challenge) };
  };
  return h;
}
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const withPassword = (id, name) => user(id, name, { pw: { h: pwHash, set: new Date().toISOString() } });


const registerPassword = (h, name, ip) => h.req('POST', '/api/register/password', { body: { name, password: GOOD }, ip });
async function registerPasskey(h, name, ip) {
  const opt = await h.req('POST', '/api/register/options', { body: { name }, ip });
  assert.equal(opt.status, 200);
  return h.req('POST', '/api/register/verify', { body: { cid: opt.body.cid, credential: softPasskey().attestation(opt.body.options.challenge) }, ip });
}
const stored = (h, id) => h.db().users.find(u => u.id === id);

test('the first password registration on an empty instance is the admin, the second is not', async t => {
  const h = await startServer(t, { env: { FIRST_USER_ADMIN: '1' } });
  const first = await registerPassword(h, 'Ana', '198.51.100.10');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.admin, true);
  assert.equal(stored(h, first.body.user.id).admin, true);
  assert.equal((await h.req('GET', '/api/admin/users', { cookie: first.cookie })).status, 200);
  assert.ok(h.audit().some(e => e.ev === 'admin.first-user' && e.uid === first.body.user.id));

  const second = await registerPassword(h, 'Bea', '198.51.100.11');
  assert.equal(second.status, 200);
  assert.equal(second.body.user.admin, false);
  assert.equal('admin' in stored(h, second.body.user.id), false);
  assert.equal((await h.req('GET', '/api/admin/users', { cookie: second.cookie })).status, 403);
});

test('the first passkey registration on an empty instance is the admin, the second is not', async t => {
  const h = await startServer(t, { env: { FIRST_USER_ADMIN: '1' } });
  const first = await registerPasskey(h, 'Ana', '198.51.100.20');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.admin, true);
  assert.equal(stored(h, first.body.user.id).admin, true);
  const second = await registerPasskey(h, 'Bea', '198.51.100.21');
  assert.equal(second.status, 200);
  assert.equal(second.body.user.admin, false);
  assert.equal('admin' in stored(h, second.body.user.id), false);
});

test('unset or FIRST_USER_ADMIN=0 leaves the first profile an ordinary one', async t => {
  for (const off of [undefined, '', '0', 'false', 'off']) {
    const h = await startServer(t, { env: { FIRST_USER_ADMIN: off } });
    const r = await registerPassword(h, 'Ana', '198.51.100.30');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.admin, false, off);
    assert.equal('admin' in stored(h, r.body.user.id), false, off);
    const k = await registerPasskey(h, 'Bea', '198.51.100.31');
    assert.equal(k.body.user.admin, false, off);
  }
});

test('an instance that already has profiles promotes nobody on upgrade or on a new registration', async t => {
  const h = await startServer(t, { env: { FIRST_USER_ADMIN: '1' }, users: [user('u1', 'Old'), user('u2', 'Older')] });
  assert.equal(stored(h, 'u1').admin, undefined);
  const r = await registerPassword(h, 'New', '198.51.100.40');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.admin, false);
  const k = await registerPasskey(h, 'Newer', '198.51.100.41');
  assert.equal(k.body.user.admin, false);
  assert.equal(h.db().users.filter(u => u.admin === true).length, 0);
});

test('an ADMIN_UIDS admin stays an admin, and does not make the next profile one', async t => {
  const h = await startServer(t, { env: { ADMIN_UIDS: 'u1', FIRST_USER_ADMIN: '1' }, users: [user('u1', 'Owner')] });
  assert.equal((await h.req('GET', '/api/admin/users', { cookie: mintSession('u1') })).status, 200);
  const r = await registerPassword(h, 'Guest', '198.51.100.50');
  assert.equal(r.body.user.admin, false);
});
