/* More than one passkey per profile, and one-time device links (#95): the routes, the proof they
   ask for — to add a passkey and to remove one — the last-way-in rule, the throttle in front of
   link redemption and the audit trail.
   Real server.js in a child, the same harness as server-password.test.js; every test talks from
   its own X-Forwarded-For address (TRUST_PROXY=1), so one test's failures never pause another's.
   The authenticator is software: a P-256 key that makes attestations ("none") and assertions the
   way a browser's would. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../password.js';
import { hashLinkCode } from '../device-link.js';
import { MAX_PASSKEYS } from '../passkeys-store.js';
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pk-'));
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

test('the list is the caller’s own passkeys, without key material, and says when one is the last way in', async t => {
  const a = softPasskey(), b = softPasskey(), c = softPasskey();
  const h = await startServer(t, {
    users: [user('u1', 'Ana'), user('u2', 'Bea')],
    creds: [a.row('u1', { name: 'Laptop', created: '2026-09-01T00:00:00.000Z' }), b.row('u2'), c.row('u1')]
  });
  assert.equal((await h.req('GET', '/api/account/passkeys')).status, 401);
  const r = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u1') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.passkeys.map(p => p.id), [a.id, c.id]);
  assert.deepEqual(r.body.passkeys[0], { id: a.id, name: 'Laptop', created: '2026-09-01T00:00:00.000Z', lastUsed: null, transports: ['internal'] });
  assert.ok(r.body.passkeys.every(p => !('publicKey' in p) && !('userId' in p) && !('counter' in p)));
  assert.equal(r.body.lastWayIn, false);
  assert.equal(r.body.password, false);
  const bea = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u2') });
  assert.equal(bea.body.lastWayIn, true);
});

test('adding a passkey needs proof, excludes the ones the profile has, and the new one signs in', async t => {
  const key = softPasskey(), fresh = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.20', cookie = mintSession('u1');
  // A session on its own is not enough.
  const bare = await h.req('POST', '/api/account/passkeys/options', { body: {}, cookie, ip });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'passkey-required');

  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key, ip), cookie, ip });
  assert.equal(opt.status, 200);
  assert.deepEqual(opt.body.options.excludeCredentials.map(c => c.id), [key.id]);
  assert.equal(opt.body.options.user.id, b64u('u1'));   // the profile's own user handle, as at sign-up
  const ver = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge), name: ' Phone\n' }, cookie, ip
  });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.deepEqual(ver.body.passkeys.map(p => p.id), [key.id, fresh.id]);
  const row = h.db().creds.find(c => c.id === fresh.id);
  assert.equal(row.userId, 'u1');
  assert.equal(row.name, 'Phone');
  assert.ok(row.created);
  // The confirming passkey was used just now.
  assert.ok(h.db().creds.find(c => c.id === key.id).lastUsed);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.add' && e.uid === 'u1' && e.msg === 'passkey'));

  // The new passkey is a way in of its own.
  const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const signedIn = await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: fresh.assertion(lo.options.challenge) }, ip });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.id, 'u1');
  assert.ok(h.db().creds.find(c => c.id === fresh.id).lastUsed);

  // The same authenticator again is refused, not stored twice.
  const again = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key, ip), cookie, ip });
  const dup = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: again.body.cid, credential: fresh.attestation(again.body.options.challenge) }, cookie, ip });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'credential-exists');
  assert.equal(h.db().creds.length, 2);
});

test('another profile’s passkey, or a challenge minted for another profile, adds nothing', async t => {
  const ana = softPasskey(), bea = softPasskey(), fresh = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [ana.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.21';
  // Bea's session confirmed with Ana's passkey.
  const wrong = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u2'), ip });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'passkey');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-add' && e.uid === 'u2' && e.msg === 'step-up-failed'));
  // Ana's ceremony finished under Bea's session.
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip });
  const hijack = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie: mintSession('u2'), ip
  });
  assert.equal(hijack.status, 400);
  assert.equal(h.db().creds.length, 2);
  // A registration made for another origin does not verify.
  const opt2 = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip });
  const phish = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt2.body.cid, credential: fresh.attestation(opt2.body.options.challenge, { origin: 'https://evil.example' }) }, cookie: mintSession('u1'), ip
  });
  assert.equal(phish.status, 400);
  assert.equal(h.db().creds.length, 2);
});

test('signing out everywhere between the proof and the new passkey ends the ceremony', async t => {
  const key = softPasskey(), fresh = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.22', cookie = mintSession('u1');
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key, ip), cookie, ip });
  assert.equal((await h.req('POST', '/api/logout/all', { body: {}, cookie, ip })).status, 200);
  // Even a session signed in afterwards cannot finish a ceremony begun under the old version.
  const late = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie: mintSession('u1', 1), ip
  });
  assert.equal(late.status, 401);
  assert.equal(h.db().creds.length, 1);
});

test('the current password proves an addition while the instance offers password sign-in', async t => {
  const fresh = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '198.51.100.23', cookie = mintSession('u1');
  assert.equal((await h.req('GET', '/api/account/passkeys', { cookie, ip })).body.password, true);
  const missing = await h.req('POST', '/api/account/passkeys/options', { body: {}, cookie, ip });
  assert.equal(missing.body.code, 'current-required');
  const wrong = await h.req('POST', '/api/account/passkeys/options', { body: { current: 'not it at all' }, cookie, ip });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'current-wrong');
  // Logged as the change it guarded, not as a failed sign-in.
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-add' && e.msg === 'bad-current'));
  assert.ok(!h.audit().some(e => e.ev === 'auth.password.fail'));
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: { current: GOOD }, cookie, ip });
  assert.equal(opt.status, 200);
  assert.deepEqual(opt.body.options.excludeCredentials, []);
  const ver = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie, ip });
  assert.equal(ver.status, 200);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.add' && e.msg === 'password'));
});

// A password kept from when the flag was on is a secret nothing checks any more — possibly an old
// or reused one. With the flag off it proves nothing, is never even compared (so wrong guesses are
// neither answered differently nor counted), and the list does not offer it; a passkey still does.
test('with PASSWORD_LOGIN off only a passkey proves anything; a stored password is ignored', async t => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(t, { env: { PASSWORD_LOGIN: '' }, users: [withPassword('u1', 'Ana'), withPassword('u2', 'Bea')], creds: [key.row('u1'), other.row('u1')] });
  const ip = '198.51.100.24', cookie = mintSession('u1');
  assert.equal((await h.req('GET', '/api/account/passkeys', { cookie, ip })).body.password, false);
  for (let i = 0; i < 7; i++) {
    for (const [method, p] of [['POST', '/api/account/passkeys/options'], ['POST', '/api/account/device-link'], ['DELETE', '/api/account/passkeys?id=' + encodeURIComponent(other.id)]]) {
      for (const current of [GOOD, 'not it at all ' + i]) {
        const r = await h.req(method, p, { body: { current }, cookie, ip });
        assert.equal(r.status, 403, `${method} ${p}`);
        assert.equal(r.body.code, 'passkey-required', `${method} ${p}`);
      }
    }
  }
  assert.ok(!h.audit().some(e => e.ev === 'auth.password.fail' || e.ev === 'auth.proof.fail' || e.ev === 'auth.password.locked'));
  assert.equal(h.db().creds.length, 2);
  assert.deepEqual(h.db().deviceLinks || [], []);
  // A profile with only a password cannot confirm anything at all.
  assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: { current: GOOD }, cookie: mintSession('u2'), ip })).body.code, 'passkey-required');
  // The passkey does, for all three.
  assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key, ip), cookie, ip })).status, 200);
  assert.equal((await h.req('POST', '/api/account/device-link', { body: await h.stepUp(key, ip), cookie, ip })).status, 200);
  const removed = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(other.id), { body: await h.stepUp(key, ip), cookie, ip });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.passkeys.map(p => p.id), [key.id]);
});

test('wrong current passwords on the way to a passkey count toward the sign-in pause', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '198.51.100.25', cookie = mintSession('u1');
  const answers = [];
  for (let i = 0; i < 7; i++) answers.push(await h.req('POST', '/api/account/passkeys/options', { body: { current: 'wrong password ' + i }, cookie, ip }));
  assert.deepEqual(answers.map(r => r.status), [403, 403, 403, 403, 403, 403, 429]);
  assert.ok(+answers[6].headers.get('retry-after') > 0);
  // The name is paused, so the right password waits too, from any address.
  assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: { current: GOOD }, cookie, ip: '198.51.100.26' })).status, 429);
});

test('a profile has at most MAX_PASSKEYS passkeys', async t => {
  const keys = Array.from({ length: MAX_PASSKEYS }, softPasskey);
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: keys.map(k => k.row('u1')) });
  const ip = '198.51.100.27', cookie = mintSession('u1');
  const r = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(keys[0], ip), cookie, ip });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'passkey-limit');
  assert.equal((await h.req('POST', '/api/account/device-link', { body: await h.stepUp(keys[0], ip), cookie, ip })).body.code, 'passkey-limit');
});

test('renaming touches only the caller’s own passkey', async t => {
  const a = softPasskey(), b = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1'), b.row('u2')] });
  const r = await h.req('POST', '/api/account/passkeys/rename', { body: { id: a.id, name: '  Work\tlaptop  ' }, cookie: mintSession('u1') });
  assert.equal(r.status, 200);
  assert.equal(r.body.passkeys[0].name, 'Work laptop');
  const theirs = await h.req('POST', '/api/account/passkeys/rename', { body: { id: b.id, name: 'mine' }, cookie: mintSession('u1') });
  assert.equal(theirs.status, 404);
  assert.equal(h.db().creds.find(c => c.id === b.id).name, undefined);
  assert.equal((await h.req('POST', '/api/account/passkeys/rename', { body: { id: a.id, name: 'x' } })).status, 401);
});

test('removing: never the last way in, never someone else’s, audited, and it stops that passkey signing in', async t => {
  const a = softPasskey(), b = softPasskey(), bea = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1', { name: 'Old phone' }), b.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.29', cookie = mintSession('u1');
  const del = async (id, proof) => h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(id), { body: await h.stepUp(proof, ip), cookie, ip });
  assert.equal((await del(bea.id, a)).status, 404);
  // A passkey may confirm its own removal: whoever uses it holds it.
  const first = await del(a.id, a);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.passkeys.map(p => p.id), [b.id]);
  assert.equal(first.body.lastWayIn, true);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.remove' && e.uid === 'u1' && e.msg === 'Old phone'));
  const last = await del(b.id, b);
  assert.equal(last.status, 409);
  assert.equal(last.body.code, 'last-way-in');
  assert.equal(h.db().creds.filter(c => c.userId === 'u1').length, 1);
  // The removed passkey is unknown from now on…
  const lo = (await h.req('POST', '/api/login/options', { body: {} })).body;
  assert.equal((await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: a.assertion(lo.options.challenge) } })).status, 404);
  // …but sessions are not tied to a passkey, so one it opened lasts until "sign out everywhere".
  assert.equal((await h.req('GET', '/api/me', { cookie })).status, 200);
});

// A stolen cookie must not choose which of the owner's ways in is left, so removing takes the
// proof adding does. Every refusal below leaves both passkeys in place.
test('removing a passkey needs proof made for it: none, another profile’s passkey, another ceremony’s challenge or a spent one remove nothing', async t => {
  const a = softPasskey(), b = softPasskey(), bea = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1'), b.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.30', cookie = mintSession('u1');
  const url = '/api/account/passkeys?id=' + encodeURIComponent(a.id);
  const refused = async (body, code) => {
    const r = await h.req('DELETE', url, { body, cookie, ip });
    assert.equal(r.status, 403, JSON.stringify(body)?.slice(0, 60));
    assert.equal(r.body.code, code);
    assert.deepEqual(h.db().creds.filter(c => c.userId === 'u1').map(c => c.id), [a.id, b.id]);
  };
  // A session on its own — with no body at all, or an empty one.
  await refused(undefined, 'passkey-required');
  await refused({}, 'passkey-required');
  // A password where the profile has none.
  await refused({ current: GOOD }, 'passkey-required');
  // Bea's passkey says nothing about Ana.
  await refused(await h.stepUp(bea, ip), 'passkey');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-remove' && e.uid === 'u1' && e.msg === 'step-up-failed'));
  // Challenges handed out for another ceremony, signed as if they were a sign-in's: adding a
  // passkey in Settings, a sign-up, redeeming a device link.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(b, ip), cookie, ip })).body;
  await refused({ cid: add.cid, credential: b.assertion(add.options.challenge) }, 'passkey');
  const reg = (await h.req('POST', '/api/register/options', { body: { name: 'Mallory' }, ip })).body;
  await refused({ cid: reg.cid, credential: b.assertion(reg.options.challenge) }, 'passkey');
  const { code } = (await h.req('POST', '/api/account/device-link', { body: await h.stepUp(b, ip), cookie, ip })).body;
  const link = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  await refused({ cid: link.cid, credential: b.assertion(link.options.challenge) }, 'passkey');
  // A sign-in challenge signed for another one, and one that finished a sign-in already.
  const lo1 = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const lo2 = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  await refused({ cid: lo1.cid, credential: b.assertion(lo2.options.challenge) }, 'passkey');
  const signedIn = await h.req('POST', '/api/login/verify', { body: { cid: lo2.cid, credential: b.assertion(lo2.options.challenge) }, ip });
  assert.equal(signedIn.status, 200);
  await refused({ cid: lo2.cid, credential: b.assertion(lo2.options.challenge) }, 'passkey');
  // A proof works once: the one that removed a passkey removes nothing else afterwards.
  const proof = await h.stepUp(b, ip);
  assert.equal((await h.req('DELETE', url, { body: proof, cookie, ip })).status, 200);
  const again = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(b.id), { body: proof, cookie, ip });
  assert.equal(again.status, 409);   // b is the last way in now, which is answered before any proof
  assert.deepEqual(h.db().creds.filter(c => c.userId === 'u1').map(c => c.id), [b.id]);
  assert.equal(h.audit().filter(e => e.ev === 'auth.passkey.remove').length, 1);
});

test('a proof is spent by the removal it was made for, and a replayed one removes nothing', async t => {
  const a = softPasskey(), b = softPasskey(), c = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [a.row('u1'), b.row('u1'), c.row('u1')] });
  const ip = '198.51.100.31', cookie = mintSession('u1');
  const proof = await h.stepUp(c, ip);
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(a.id), { body: proof, cookie, ip })).status, 200);
  const replay = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(b.id), { body: proof, cookie, ip });
  assert.equal(replay.status, 403);
  assert.equal(replay.body.code, 'passkey');
  assert.deepEqual(h.db().creds.map(x => x.id), [b.id, c.id]);
  // The confirming passkey's use is recorded like any other.
  assert.ok(h.db().creds.find(x => x.id === c.id).lastUsed);
});

test('wrong current passwords given to remove a passkey count toward the sign-in pause, and are audited as such', async t => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1'), other.row('u1')] });
  const ip = '198.51.100.32', cookie = mintSession('u1');
  const url = '/api/account/passkeys?id=' + encodeURIComponent(other.id);
  assert.equal((await h.req('DELETE', url, { body: {}, cookie, ip })).body.code, 'current-required');
  const answers = [];
  for (let i = 0; i < 7; i++) answers.push(await h.req('DELETE', url, { body: { current: 'wrong password ' + i }, cookie, ip }));
  assert.deepEqual(answers.map(r => r.status), [403, 403, 403, 403, 403, 403, 429]);
  assert.equal(answers[0].body.code, 'current-wrong');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-remove' && e.uid === 'u1' && e.msg === 'bad-current'));
  assert.ok(h.audit().some(e => e.ev === 'auth.password.locked' && e.uid === 'u1'));
  // The name is paused: the right password waits too, from anywhere, and so does a sign-in.
  assert.equal((await h.req('DELETE', url, { body: { current: GOOD }, cookie, ip: '198.51.100.33' })).status, 429);
  assert.equal((await h.req('POST', '/api/login/password', { body: { name: 'Ana', password: GOOD }, ip: '198.51.100.33' })).status, 429);
  assert.equal(h.db().creds.length, 2);
  // A passkey is never paused by it.
  assert.equal((await h.req('DELETE', url, { body: await h.stepUp(key, ip), cookie, ip })).status, 200);
});

test('the current password proves a removal too, while password sign-in is on', async t => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1'), other.row('u1', { name: 'Tablet' })] });
  const ip = '198.51.100.34', cookie = mintSession('u1');
  const r = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(other.id), { body: { current: GOOD }, cookie, ip });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.passkeys.map(p => p.id), [key.id]);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.remove' && e.msg === 'Tablet'));
});

// Both of a profile's two ways in removed at once, each request with its own good proof: the
// checks before the proof pass for both, so the one that finishes second has to find out after
// its proof that it would now leave the profile with no way in.
test('removing the password and the last passkey at the same time leaves one of them', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.35', cookie = mintSession('u1');
  const [pw, pk] = await Promise.all([
    // The password's proof runs scrypt, so the passkey removal overtakes it.
    h.req('DELETE', '/api/account/password', { body: { current: GOOD }, cookie, ip }),
    (async () => h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(key.id), { body: await h.stepUp(key, ip), cookie, ip }))()
  ]);
  assert.deepEqual([pw.status, pk.status].filter(s => s === 200).length, 1, `${pw.status} ${JSON.stringify(pw.body)} / ${pk.status} ${JSON.stringify(pk.body)}`);
  assert.ok([403, 409].includes(pw.status === 200 ? pk.status : pw.status));
  const u = h.db().users[0];
  assert.equal(h.db().creds.length + (u.pw ? 1 : 0), 1, 'the profile kept exactly one way in');
});

test('a password is a way in only while the instance offers password sign-in', async t => {
  for (const [flag, status] of [['1', 200], ['', 409]]) {
    const key = softPasskey();
    const h = await startServer(t, { env: { PASSWORD_LOGIN: flag }, users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
    const ip = flag ? '198.51.100.36' : '198.51.100.37';
    const list = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u1'), ip });
    assert.equal(list.body.lastWayIn, !flag);
    assert.equal(list.body.password, !!flag);
    const r = await h.req('DELETE', '/api/account/passkeys?id=' + key.id, { body: await h.stepUp(key, ip), cookie: mintSession('u1'), ip });
    assert.equal(r.status, status, `PASSWORD_LOGIN=${flag}`);
  }
});

test('a password-only profile keeps its password until a passkey is added, and then may drop it', async t => {
  const fresh = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '198.51.100.28', cookie = mintSession('u1');
  // Refused before any proof is asked for: the answer would be the same with one.
  assert.equal((await h.req('DELETE', '/api/account/password', { body: {}, cookie, ip })).body.code, 'last-way-in');
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: { current: GOOD }, cookie, ip });
  await h.req('POST', '/api/account/passkeys/verify', { body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie, ip });
  assert.equal((await h.req('DELETE', '/api/account/password', { body: {}, cookie, ip })).body.code, 'current-required');
  assert.equal((await h.req('DELETE', '/api/account/password', { body: { current: GOOD }, cookie, ip })).status, 200);
  // And now the passkey is the last way in.
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + fresh.id, { body: await h.stepUp(fresh, ip), cookie, ip })).body.code, 'last-way-in');
});

/* ------------------------------------------------------------------ device links ---------- */

// Makes a link as Ana would in Settings: confirmed with her passkey.
async function makeLink(h, key, uid, ip) {
  return h.req('POST', '/api/account/device-link', { body: await h.stepUp(key, ip), cookie: mintSession(uid), ip });
}
// Redeems it as the other device would: options, then the new passkey.
async function redeem(h, code, fresh, ip, name) {
  const opt = await h.req('POST', '/api/device-link/options', { body: { code }, ip });
  if (opt.status !== 200) return opt;
  return h.req('POST', '/api/device-link/verify', { body: { code, cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge), name }, ip });
}

test('a device link: made with proof, kept only as a hash, redeemed once by a new passkey that signs the device in', async t => {
  const key = softPasskey(), phone = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [key.row('u1')] });
  const ip = '198.51.100.40';
  assert.equal((await h.req('POST', '/api/account/device-link', { body: {} })).status, 401);
  assert.equal((await h.req('POST', '/api/account/device-link', { body: {}, cookie: mintSession('u1'), ip })).body.code, 'passkey-required');

  const made = await makeLink(h, key, 'u1', ip);
  assert.equal(made.status, 200);
  const { code, expires } = made.body;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(expires > Date.now() + 9 * 60000 && expires <= Date.now() + 10 * 60000);
  const stored = fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
  assert.doesNotMatch(stored, new RegExp(code));
  assert.doesNotMatch(stored, new RegExp(code.replace(/-/g, '')));
  assert.deepEqual(h.db().deviceLinks.map(l => [l.userId, l.h]), [['u1', hashLinkCode(code)]]);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.create' && e.uid === 'u1' && e.msg === 'passkey'));

  // The other device, signed in as nobody.
  const opt = await h.req('POST', '/api/device-link/options', { body: { code: code.toLowerCase() }, ip: '198.51.100.41' });
  assert.equal(opt.status, 200);
  assert.equal(opt.body.name, 'Ana');
  assert.equal(opt.body.id, 'u1');   // what the other device tells profiles apart by, not the name
  assert.deepEqual(opt.body.options.excludeCredentials.map(c => c.id), [key.id]);
  const done = await h.req('POST', '/api/device-link/verify', {
    body: { code, cid: opt.body.cid, credential: phone.attestation(opt.body.options.challenge), name: 'Phone' }, ip: '198.51.100.41'
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(done.body.user, { id: 'u1', name: 'Ana', admin: false });
  assert.ok(done.cookie);
  assert.equal((await h.req('GET', '/api/me', { cookie: done.cookie })).body.user.id, 'u1');
  const row = h.db().creds.find(c => c.id === phone.id);
  assert.equal(row.userId, 'u1');
  assert.equal(row.name, 'Phone');
  assert.deepEqual(h.db().deviceLinks, []);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.ok' && e.uid === 'u1'));

  // Used: gone for good, whichever step tries it.
  const again = await redeem(h, code, softPasskey(), '198.51.100.42');
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'link-invalid');
  assert.equal(h.db().creds.length, 2);
});

test('a password-only profile can make a link with its password, and the phone gets a passkey', async t => {
  const phone = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '198.51.100.43';
  const made = await h.req('POST', '/api/account/device-link', { body: { current: GOOD }, cookie: mintSession('u1'), ip });
  assert.equal(made.status, 200);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.create' && e.msg === 'password'));
  assert.equal((await redeem(h, made.body.code, phone, ip)).status, 200);
  assert.equal(h.db().creds[0].userId, 'u1');
});

test('an expired link, a replaced link and a link of a disabled profile are all just wrong', async t => {
  const code = 'ABCD-EFGH-JKLM', old = 'ZZZZ-YYYY-XXXX', locked = 'QQQQ-RRRR-SSSS';
  const h = await startServer(t, {
    users: [user('u1', 'Ana'), user('u2', 'Bea', { disabled: true })],
    deviceLinks: [
      { h: hashLinkCode(code), userId: 'u1', exp: Date.now() - 1000, created: Date.now() - 601000 },
      { h: hashLinkCode(locked), userId: 'u2', exp: Date.now() + 60000, created: Date.now() }
    ]
  });
  const ip = '198.51.100.44';
  for (const c of [code, old, locked, '', 'x'.repeat(5000)]) {
    const r = await h.req('POST', '/api/device-link/options', { body: { code: c }, ip });
    assert.equal(r.status, 400, c.slice(0, 20));
    assert.equal(r.body.code, 'link-invalid');
  }
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: { toString: 1 } }, ip })).status, 400);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.fail' && e.msg === 'user-unavailable' && e.uid === 'u2'));
});

test('removing a passkey drops an unused code, so one made with it just before adds nothing afterwards', async t => {
  const key = softPasskey(), stolen = softPasskey(), thief = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1'), stolen.row('u1', { name: 'Old phone' })] });
  const ip = '198.51.100.54';
  // Whoever holds the lost phone makes a code with its passkey…
  const { code } = (await makeLink(h, stolen, 'u1', ip)).body;
  assert.equal(h.db().deviceLinks.length, 1);
  // …the owner removes that passkey…
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(stolen.id), { body: await h.stepUp(key, ip), cookie: mintSession('u1'), ip })).status, 200);
  assert.deepEqual(h.db().deviceLinks, []);
  // …and the code no longer adds a new one.
  const r = await redeem(h, code, thief, '203.0.113.54');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'link-invalid');
  assert.deepEqual(h.db().creds.map(c => c.id), [key.id]);
  // A refused removal leaves the owner's own code alone.
  const mine = (await makeLink(h, key, 'u1', ip)).body.code;
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(key.id), { body: await h.stepUp(key, ip), cookie: mintSession('u1'), ip })).status, 409);
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: mine }, ip })).status, 200);
});

test('a newer link replaces the older one, and signing out everywhere or a new password drops it', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.45', cookie = mintSession('u1');
  const first = (await makeLink(h, key, 'u1', ip)).body.code;
  const second = (await makeLink(h, key, 'u1', ip)).body.code;
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: first }, ip })).status, 400);
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: second }, ip })).status, 200);
  await h.req('POST', '/api/logout/all', { body: {}, cookie, ip });
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: second }, ip })).status, 400);

  // A new one, under the session version after that sign-out — and then a new password.
  const after = mintSession('u1', 1);
  const third = (await h.req('POST', '/api/account/device-link', { body: await h.stepUp(key, ip), cookie: after, ip })).body.code;
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: third }, ip })).status, 200);
  const set = await h.req('POST', '/api/account/password', { body: { current: GOOD, next: 'another good long passphrase' }, cookie: after, ip });
  assert.equal(set.status, 200);
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: third }, ip })).status, 400);
});

test('a link redeemed after the owner signed out everywhere mid-ceremony makes no passkey', async t => {
  const key = softPasskey(), thief = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.46';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const opt = await h.req('POST', '/api/device-link/options', { body: { code }, ip });
  await h.req('POST', '/api/logout/all', { body: {}, cookie: mintSession('u1'), ip });
  const r = await h.req('POST', '/api/device-link/verify', { body: { code, cid: opt.body.cid, credential: thief.attestation(opt.body.options.challenge) }, ip });
  assert.equal(r.status, 400);
  assert.equal(r.cookie, null);
  assert.equal(h.db().creds.length, 1);
});

test('two devices racing with one code: exactly one gets the passkey and the session', async t => {
  const key = softPasskey(), one = softPasskey(), two = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.47';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const o1 = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  const o2 = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  const results = await Promise.all([
    h.req('POST', '/api/device-link/verify', { body: { code, cid: o1.cid, credential: one.attestation(o1.options.challenge) }, ip }),
    h.req('POST', '/api/device-link/verify', { body: { code, cid: o2.cid, credential: two.attestation(o2.options.challenge) }, ip })
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal(results.filter(r => r.cookie).length, 1);
  assert.equal(h.db().creds.length, 2);
});

test('a challenge from one ceremony does not finish the other, nor a link of another profile', async t => {
  const ana = softPasskey(), bea = softPasskey(), fresh = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [ana.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.48';
  const anaCode = (await makeLink(h, ana, 'u1', ip)).body.code;
  const beaCode = (await makeLink(h, bea, 'u2', ip)).body.code;
  // Bea's options, Ana's code: the challenge belongs to the other link.
  const beaOpt = (await h.req('POST', '/api/device-link/options', { body: { code: beaCode }, ip })).body;
  const cross = await h.req('POST', '/api/device-link/verify', { body: { code: anaCode, cid: beaOpt.cid, credential: fresh.attestation(beaOpt.options.challenge) }, ip });
  assert.equal(cross.status, 400);
  // A Settings ceremony's challenge presented as a link's.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip })).body;
  const mixed = await h.req('POST', '/api/device-link/verify', { body: { code: anaCode, cid: add.cid, credential: fresh.attestation(add.options.challenge) }, ip });
  assert.equal(mixed.status, 400);
  // …and a link's challenge presented to Settings.
  const linkOpt = (await h.req('POST', '/api/device-link/options', { body: { code: anaCode }, ip })).body;
  const mixed2 = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: linkOpt.cid, credential: fresh.attestation(linkOpt.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(mixed2.status, 400);
  assert.equal(h.db().creds.length, 2);
  // Both codes still work for their own profiles.
  assert.equal((await redeem(h, beaCode, fresh, ip)).body.user.id, 'u2');
});

test('wrong codes pause link redemption for the address, and only that', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.49';
  const { code } = (await makeLink(h, key, 'u1', '198.51.100.50')).body;
  // 20 wrong codes are free; the 21st is still answered, and starts the pause.
  for (let i = 0; i < 21; i++) {
    const r = await h.req('POST', '/api/device-link/options', { body: { code: 'WRONG' + i }, ip });
    assert.equal(r.status, 400, `attempt ${i}`);
  }
  const paused = await h.req('POST', '/api/device-link/options', { body: { code: 'ZZZZ-ZZZZ-ZZZZ' }, ip });
  assert.equal(paused.status, 429);
  assert.equal(paused.body.code, 'locked');
  assert.ok(+paused.headers.get('retry-after') > 0);
  // Even the right code waits at that address…
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip })).status, 429);
  assert.equal((await h.req('POST', '/api/device-link/verify', { body: { code }, ip })).status, 429);
  assert.ok(h.audit().some(e => e.ev === 'auth.throttled' && e.msg === 'link'));
  // …while another address redeems it, and sign-in at the paused one is untouched.
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip: '198.51.100.51' })).status, 200);
  assert.equal((await h.req('POST', '/api/login/options', { body: {}, ip })).status, 200);
  const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  assert.equal((await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: key.assertion(lo.options.challenge) }, ip })).status, 200);
});

test('link redemption keeps the origin check; the account routes do too', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.52';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const crossSite = { 'Sec-Fetch-Site': 'cross-site' };
  const sibling = { 'Sec-Fetch-Site': 'same-site' };
  const noFetchMeta = { 'Sec-Fetch-Site': '', Origin: 'https://evil.example' };
  for (const headers of [crossSite, sibling, noFetchMeta]) {
    assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/device-link/verify', { body: { code }, ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/account/device-link', { body: {}, cookie: mintSession('u1'), ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: {}, cookie: mintSession('u1'), ip, headers })).status, 403);
    assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + key.id, { cookie: mintSession('u1'), ip, headers })).status, 403);
  }
  // The refused requests used nothing up.
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip })).status, 200);
});

test('a Settings or device-link challenge never finishes a sign-up, a sign-in or a proof — and the code stays good once', async t => {
  const key = softPasskey(), thief = softPasskey(), phone = softPasskey(), newcomer = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.53', other = '203.0.113.53';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const linkOptions = async () => (await h.req('POST', '/api/device-link/options', { body: { code }, ip: other })).body;
  const unchanged = () => {
    const db = h.db();
    assert.deepEqual(db.users.map(u => u.id), ['u1']);
    assert.deepEqual(db.creds.map(c => c.id), [key.id]);
    assert.equal(db.deviceLinks.length, 1);
  };

  // Someone who read the code sends the link's challenge to sign-up instead of to the link route.
  for (let i = 0; i < 2; i++) {
    const opt = await linkOptions();
    const r = await h.req('POST', '/api/register/verify', { body: { cid: opt.cid, credential: thief.attestation(opt.options.challenge) }, ip: other });
    assert.equal(r.status, 400);
    assert.equal(r.cookie, null);
    unchanged();
  }
  assert.ok(h.audit().some(e => e.ev === 'auth.register.fail' && e.msg === 'challenge-expired'));
  assert.ok(!h.audit().some(e => e.ev === 'auth.register.ok'));

  // A Settings ceremony's challenge is no sign-up either.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key, ip), cookie: mintSession('u1'), ip })).body;
  const viaAdd = await h.req('POST', '/api/register/verify', { body: { cid: add.cid, credential: thief.attestation(add.options.challenge) }, ip });
  assert.equal(viaAdd.status, 400);
  assert.equal(viaAdd.cookie, null);
  unchanged();

  // Nor is a link's challenge a sign-in, or the proof that makes another code.
  const asLogin = await linkOptions();
  const signIn = await h.req('POST', '/api/login/verify', { body: { cid: asLogin.cid, credential: key.assertion(asLogin.options.challenge) }, ip: other });
  assert.equal(signIn.status, 400);
  assert.equal(signIn.cookie, null);
  const asProof = await linkOptions();
  const proof = await h.req('POST', '/api/account/device-link', { body: { cid: asProof.cid, credential: key.assertion(asProof.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(proof.status, 403);
  assert.equal(proof.body.code, 'passkey');
  // …and a sign-up's challenge proves nothing.
  const reg = (await h.req('POST', '/api/register/options', { body: { name: 'Mallory' }, ip })).body;
  const regProof = await h.req('POST', '/api/account/device-link', { body: { cid: reg.cid, credential: key.assertion(reg.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(regProof.status, 403);
  unchanged();

  // A link challenge fetched before "sign out everywhere" finishes nothing afterwards.
  const early = await linkOptions();
  const early2 = await linkOptions();
  assert.equal((await h.req('POST', '/api/logout/all', { body: {}, cookie: mintSession('u1'), ip })).status, 200);
  const late = await h.req('POST', '/api/register/verify', { body: { cid: early.cid, credential: thief.attestation(early.options.challenge) }, ip: other });
  assert.equal(late.status, 400);
  const late2 = await h.req('POST', '/api/device-link/verify', { body: { code, cid: early2.cid, credential: thief.attestation(early2.options.challenge) }, ip: other });
  assert.equal(late2.status, 400);
  assert.deepEqual(h.db().users.map(u => u.id), ['u1']);
  assert.deepEqual(h.db().creds.map(c => c.id), [key.id]);

  // The owner's next code is redeemed exactly once, by the link route.
  const next = (await h.req('POST', '/api/account/device-link', { body: await h.stepUp(key, ip), cookie: mintSession('u1', 1), ip })).body.code;
  const done = await redeem(h, next, phone, ip, 'Phone');
  assert.equal(done.status, 200);
  assert.equal(done.body.user.id, 'u1');
  assert.equal((await redeem(h, next, softPasskey(), ip)).status, 400);
  assert.deepEqual(h.db().creds.map(c => [c.id, c.userId]), [[key.id, 'u1'], [phone.id, 'u1']]);

  // Sign-up with its own challenge still works, and makes one new profile.
  const signUp = (await h.req('POST', '/api/register/options', { body: { name: 'Cleo' }, ip })).body;
  const made = await h.req('POST', '/api/register/verify', { body: { cid: signUp.cid, credential: newcomer.attestation(signUp.options.challenge) }, ip });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.user.name, 'Cleo');
  assert.ok(made.cookie);
  assert.equal(h.db().users.length, 2);
});
