/* Password sign-in next to passkeys (#118): the routes, the throttle in front of them, and the
   rules that make a second way into an account safe to offer. Real server.js in a child, the
   same harness as server-pairing.test.js. Every test talks from its own X-Forwarded-For address
   (TRUST_PROXY=1), so one test's failures never pause another's. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword, hashResetCode } from '../password.js';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const b64u = b => Buffer.from(b).toString('base64url');

const mintSession = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

// A passkey in software: a P-256 key whose public half goes into db.json as the COSE key the
// server stores, and whose private half signs assertions the way an authenticator would.
function softPasskey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')
  ]);
  const id = crypto.randomBytes(16).toString('base64url');
  let counter = 0;
  return {
    id,
    row: userId => ({ id, userId, publicKey: cose.toString('base64url'), counter: 0, transports: ['internal'] }),
    assertion(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter);
      const authData = Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([0x05]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), privateKey);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }
      };
    }
  };
}

const GOOD = 'correct horse battery staple';
let pwHash;   // one real hash of GOOD, made once — every user below that "has a password" shares it
let oldHash;  // GOOD at N = 2^14, as an instance with older parameters would have stored it
// Made before any test runs: withPassword() reads it while a test's arguments to startServer are
// still being built, so a test run on its own would otherwise give its user no hash at all.
before(async () => { pwHash ??= await hashPassword(GOOD); });

// A hash in password.js's own format at a cost other than today's, so a sign-in rehashes it.
const hashAt = (pw, ln) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16);
  crypto.scrypt(pw.normalize('NFKC'), salt, 32, { N: 2 ** ln, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err)
    : resolve(`$scrypt$v=1$ln=${ln},r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`));
});

async function startServer(t, { env = {}, users = [], creds = [], invites = [] } = {}) {
  pwHash ??= await hashPassword(GOOD);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pw-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites }));
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
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  // Every request looks like the app talking to its own backend unless a test says otherwise.
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
  return h;
}
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const withPassword = (id, name, extra = {}) => user(id, name, { pw: { h: pwHash, set: new Date().toISOString() }, ...extra });
const login = (h, name, password, ip) => h.req('POST', '/api/login/password', { body: { name, password }, ip });

test('with PASSWORD_LOGIN off every password route is a 404 and /api/config says nothing', async t => {
  const h = await startServer(t, { env: { PASSWORD_LOGIN: '' }, users: [user('u1', 'Ana')] });
  const cookie = `gymsid=${mintSession('u1')}`;
  for (const [m, p] of [
    ['POST', '/api/login/password'], ['POST', '/api/register/password'], ['POST', '/api/login/password-reset'],
    ['GET', '/api/account/password'], ['POST', '/api/account/password'], ['DELETE', '/api/account/password'],
    ['POST', '/api/admin/user/password-reset']
  ]) {
    const r = await h.req(m, p, { body: m === 'GET' ? undefined : { name: 'Ana', password: GOOD }, cookie });
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  const cfg = await h.req('GET', '/api/config');
  assert.equal('password_login' in cfg.body, false);
});

test('signs in with the right password, case-insensitively by profile name, like a passkey does', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana Lu')] });
  assert.equal((await h.req('GET', '/api/config')).body.password_login, true);
  const r = await login(h, '  ANA lu ', GOOD, '198.51.100.2');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.user, { id: 'u1', name: 'Ana Lu', admin: false });
  // Same cookie as a passkey sign-in: HttpOnly, SameSite=Lax, no Secure over plain http.
  assert.ok(r.cookie);
  const raw = r.headers.getSetCookie().find(c => c.startsWith('gymsid='));
  assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Lax/); assert.doesNotMatch(raw, /Secure/);
  assert.equal((await h.req('GET', '/api/me', { cookie: r.cookie })).status, 200);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.ok' && e.uid === 'u1'));
});

test('a wrong password and an unknown name get the same answer, after the same work', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana'), user('u2', 'Bea')] });
  const time = async (name, ip) => {
    const t0 = performance.now();
    const r = await login(h, name, 'not the password at all', ip);
    return { r, ms: performance.now() - t0 };
  };
  const known = [], unknown = [], noPw = [];
  for (let i = 0; i < 3; i++) {
    known.push(await time('Ana', '198.51.100.10'));
    unknown.push(await time('Nobody' + i, '198.51.100.11'));
    noPw.push(await time('Bea', '198.51.100.12'));   // exists, but has never set a password
  }
  for (const { r } of [...known, ...unknown, ...noPw]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: 'wrong name or password', code: 'bad-credentials' });
  }
  // Both paths run scrypt; a missing one would answer in well under a tenth of the time.
  const median = xs => xs.map(x => x.ms).sort((a, b) => a - b)[1];
  assert.ok(median(unknown) > median(known) * 0.4, `unknown ${median(unknown)} ms vs known ${median(known)} ms`);
  assert.ok(median(noPw) > median(known) * 0.4, `no password ${median(noPw)} ms vs known ${median(known)} ms`);
  // The log names the account behind a wrong password, and never what was typed as a name.
  const fails = h.audit().filter(e => e.ev === 'auth.password.fail');
  assert.ok(fails.some(e => e.uid === 'u1' && e.msg === 'bad-password'));
  assert.ok(fails.every(e => !String(e.name || '').startsWith('Nobody')));
});

test('five wrong passwords pause the name, whoever sends them, and the pause says how long', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  for (let i = 0; i < 5; i++) assert.equal((await login(h, 'ana', 'wrong password ' + i, `198.51.100.${20 + i}`)).status, 401);
  // The sixth still gets its answer and starts the pause…
  assert.equal((await login(h, 'ana', 'wrong password 6', '198.51.100.30')).status, 401);
  // …after which even the right password, from yet another address, waits.
  const r = await login(h, 'Ana', GOOD, '198.51.100.31');
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'locked');
  const after = +r.headers.get('retry-after');
  assert.ok(after > 0 && after <= 60, `Retry-After ${after}`);
  assert.equal(r.body.retryAfter, after);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.locked' && e.uid === 'u1'));

  // A name nobody has pauses exactly the same way, so a 429 does not reveal that a name exists.
  for (let i = 0; i < 6; i++) await login(h, 'ghost', 'wrong password ' + i, `198.51.100.${40 + i}`);
  assert.equal((await login(h, 'ghost', GOOD, '198.51.100.50')).status, 429);
});

test('twenty failures from one address pause that address for every name; others are unaffected', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '203.0.113.7';
  for (let i = 0; i < 20; i++) assert.equal((await login(h, 'name' + i, 'wrong password', ip)).status, 401);
  assert.equal((await login(h, 'name20', 'wrong password', ip)).status, 401);   // this one starts the pause
  const r = await login(h, 'Ana', GOOD, ip);
  assert.equal(r.status, 429);
  assert.ok(+r.headers.get('retry-after') > 0);
  assert.equal((await login(h, 'Ana', GOOD, '203.0.113.8')).status, 200);
  // X-Forwarded-For is read from the right: a client-supplied entry in front changes nothing.
  assert.equal((await login(h, 'Ana', GOOD, `192.0.2.99, ${ip}`)).status, 429);
  assert.ok(h.audit().some(e => e.ev === 'auth.throttled' && e.msg === 'password'));
});

// scrypt takes a tenth of a second, so guesses sent at once are all in flight before the first
// is answered. Each is counted the moment it starts: the allowance is what gets checked, the rest
// wait — however many arrive together.
test('guesses sent all at once are checked only up to the pause, per name and per address', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const byName = await Promise.all(Array.from({ length: 20 }, (_, i) => login(h, 'Ana', 'wrong password ' + i, `198.51.100.${160 + i}`)));
  const statuses = byName.map(r => r.status);
  assert.equal(statuses.filter(s => s === 401).length, 6, `five free and the one that starts the pause: ${statuses}`);
  assert.equal(statuses.filter(s => s === 429).length, 14);
  assert.equal((await login(h, 'Ana', GOOD, '198.51.100.199')).status, 429, 'the name is paused');

  const ip = '203.0.113.90';
  const byAddr = await Promise.all(Array.from({ length: 30 }, (_, i) => login(h, 'someone' + i, 'wrong password', ip)));
  const a = byAddr.map(r => r.status);
  assert.equal(a.filter(s => s === 401).length, 21, `twenty free and the one that starts the pause: ${a}`);
  assert.equal(a.filter(s => s === 429).length, 9);
  assert.equal(h.audit().filter(e => e.ev === 'auth.password.locked').length, 1, 'the pause is logged once');
});

test('the owner signing in while guesses are in flight is not counted against the name', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  // Five wrong and the right one, side by side: whichever of them is sixth starts the pause but is
  // still checked, and the right one clears the name when it lands.
  const all = await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => login(h, 'Ana', 'wrong password ' + i, `198.51.100.${210 + i}`)),
    login(h, 'Ana', GOOD, '198.51.100.215')
  ]);
  assert.deepEqual(all.map(r => r.status), [401, 401, 401, 401, 401, 200]);
  // Five wrong from here on are free again, and only the sixth pauses.
  for (let i = 0; i < 6; i++) assert.equal((await login(h, 'Ana', 'wrong again ' + i, `198.51.100.${220 + i}`)).status, 401);
  assert.equal((await login(h, 'Ana', GOOD, '198.51.100.230')).status, 429);
});

test('the burst budget answers 429 with Retry-After on the password routes', async t => {
  const h = await startServer(t);
  let last;
  for (let i = 0; i < 61; i++) last = await h.req('POST', '/api/login/password', { body: {}, ip: '203.0.113.60' });
  assert.equal(last.status, 429);
  assert.ok(+last.headers.get('retry-after') > 0);
  assert.equal((await h.req('POST', '/api/login/password-reset', { body: {}, ip: '203.0.113.60' })).status, 429);
  assert.equal((await h.req('POST', '/api/login/password', { body: {}, ip: '203.0.113.61' })).status, 400);
});

test('without TRUST_PROXY a forwarded address is ignored: the socket is who is counted', async t => {
  const h = await startServer(t, { env: { TRUST_PROXY: '' } });
  for (let i = 0; i < 61; i++) await h.req('POST', '/api/login/password', { body: {}, ip: `203.0.113.${i + 100}` });
  assert.equal((await h.req('POST', '/api/login/password', { body: {}, ip: '192.0.2.1' })).status, 429);
});

// Behind a proxy that hides the visitor, every request comes from one address. Whatever one client
// sends from there must not pause anybody's passkey sign-in, passkey signup or phone pairing —
// which were never throttled, and are not now.
test('a flood from a shared address leaves passkey sign-in, registration and pairing working', async t => {
  const key = softPasskey();
  const h = await startServer(t, {
    env: { TRUST_PROXY: '', INVITE_ONLY: '1' },
    users: [withPassword('u1', 'Ana')], creds: [key.row('u1')],
    invites: [{ code: 'GOODCODE', created: new Date().toISOString() }]
  });
  for (let i = 0; i < 100; i++) await h.req('POST', '/api/login/options', { body: {} });
  for (let i = 0; i < 30; i++) assert.equal((await h.req('POST', '/api/register/options', { body: { name: 'X', code: 'JUNK' + i } })).status, 403);
  for (let i = 0; i < 30; i++) assert.equal((await h.req('POST', '/api/pair/redeem', { body: { code: 'JUNK' + i } })).status, 400);
  await Promise.all(Array.from({ length: 25 }, (_, i) => login(h, 'name' + i, 'wrong password')));
  // Password sign-in is what the shared address pauses — for everybody behind it, as documented.
  assert.equal((await login(h, 'Ana', GOOD)).status, 429);

  const { cid, options } = (await h.req('POST', '/api/login/options', { body: {} })).body;
  const signedIn = await h.req('POST', '/api/login/verify', { body: { cid, credential: key.assertion(options.challenge) } });
  assert.equal(signedIn.status, 200, 'passkey sign-in');
  assert.ok(signedIn.cookie);
  assert.equal((await h.req('POST', '/api/register/options', { body: { name: 'Cleo', code: 'goodcode' } })).status, 200, 'passkey signup');
  const { code } = (await h.req('POST', '/api/pair/create', { cookie: signedIn.cookie })).body;
  assert.equal((await h.req('POST', '/api/pair/redeem', { body: { code } })).status, 200, 'pairing');
  assert.equal(h.audit().some(e => e.ev === 'auth.throttled' && e.msg !== 'password'), false);

  // With PASSWORD_LOGIN off nothing at all is counted.
  const off = await startServer(t, { env: { TRUST_PROXY: '', PASSWORD_LOGIN: '' } });
  for (let i = 0; i < 100; i++) assert.equal((await off.req('POST', '/api/login/options', { body: {} })).status, 200);
});

test('the password routes keep the origin check: no login CSRF', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const evil = { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' };
  for (const p of ['/api/login/password', '/api/register/password', '/api/login/password-reset']) {
    const r = await h.req('POST', p, { body: { name: 'Ana', password: GOOD }, headers: evil, ip: '198.51.100.70' });
    assert.equal(r.status, 403, p);
    assert.equal(r.body.error, 'cross-origin request refused');
    assert.equal(r.cookie, null);
  }
  // A browser without Sec-Fetch-Site falls back to Origin, which has to be ORIGIN.
  const noMeta = await h.req('POST', '/api/login/password', { body: { name: 'Ana', password: GOOD }, headers: { 'Sec-Fetch-Site': '', Origin: 'http://192.168.1.20:8080' }, ip: '198.51.100.71' });
  assert.equal(noMeta.status, 403);
  const ok = await h.req('POST', '/api/login/password', { body: { name: 'Ana', password: GOOD }, headers: { 'Sec-Fetch-Site': '', Origin: ORIGIN }, ip: '198.51.100.72' });
  assert.equal(ok.status, 200);
});

test('registration with a password: policy, unique names among password holders, and the invite', async t => {
  const h = await startServer(t, {
    env: { INVITE_ONLY: '1' },
    users: [withPassword('u1', 'Ana'), user('u2', 'Bea')],
    invites: [{ code: 'INVITE1', created: new Date().toISOString() }]
  });
  const reg = (body, ip = '198.51.100.80') => h.req('POST', '/api/register/password', { body, ip });
  assert.deepEqual((await reg({ name: 'Cleo', password: GOOD })).body.code, 'invite');
  assert.equal((await reg({ name: 'Cleo', password: GOOD, code: 'WRONG' })).status, 403);
  assert.equal((await reg({ name: 'Cleo', password: 'short', code: 'invite1' })).body.code, 'too-short');
  assert.equal((await reg({ name: 'Cleo', password: 'Password123!', code: 'invite1' })).body.code, 'too-common');
  assert.equal((await reg({ name: 'Cleo', password: 'cleo.2024.2024', code: 'invite1' })).body.code, 'too-common');
  assert.equal((await reg({ name: 'ANA', password: GOOD, code: 'invite1' })).status, 409);
  const r = await reg({ name: 'Cleo', password: GOOD, code: 'invite1' });
  assert.equal(r.status, 200);
  assert.ok(r.cookie);
  const db = h.db();
  const cleo = db.users.find(u => u.name === 'Cleo');
  assert.match(cleo.pw.h, /^\$scrypt\$v=1\$ln=15,r=8,p=1\$/);
  assert.equal(JSON.stringify(db).includes(GOOD), false, 'the password itself is never stored');
  assert.equal(db.invites[0].usedBy, cleo.id);
  // Burned: the same code does not let anyone else in.
  assert.equal((await reg({ name: 'Dora', password: GOOD, code: 'INVITE1' }, '198.51.100.81')).status, 403);
  // A name that only a passkey profile has is free to take; the two never meet at sign-in.
  const h2 = await startServer(t, { users: [user('u2', 'Bea')] });
  assert.equal((await h2.req('POST', '/api/register/password', { body: { name: 'bea', password: GOOD }, ip: '198.51.100.82' })).status, 200);
});

test('setting a first password needs a passkey made for it, not just a session', async t => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [key.row('u1'), other.row('u2')] });
  const cookie = `gymsid=${mintSession('u1')}`;
  const ip = '198.51.100.90';
  const status = await h.req('GET', '/api/account/password', { cookie, ip });
  assert.deepEqual(status.body, { set: false, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false, email: null });

  assert.equal((await h.req('POST', '/api/account/password', { body: { next: GOOD }, cookie, ip })).body.code, 'passkey-required');
  assert.equal((await h.req('POST', '/api/account/password', { body: { next: GOOD, current: 'anything at all' }, cookie, ip })).body.code, 'passkey-required');

  const stepUp = async pk => {
    const { cid, options } = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
    return { cid, credential: pk.assertion(options.challenge) };
  };
  // Somebody else's passkey proves nothing about this account.
  const foreign = await h.req('POST', '/api/account/password', { body: { next: GOOD, ...(await stepUp(other)) }, cookie, ip });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, 'passkey');
  const r = await h.req('POST', '/api/account/password', { body: { next: GOOD, ...(await stepUp(key)) }, cookie, ip });
  assert.equal(r.status, 200);
  assert.ok(r.cookie, 'this session carries on');
  // The old cookie is gone with the session version it carried.
  assert.equal((await h.req('GET', '/api/me', { cookie, ip })).status, 401);
  assert.equal((await h.req('GET', '/api/me', { cookie: r.cookie, ip })).status, 200);
  assert.equal((await login(h, 'ana', GOOD, '198.51.100.91')).status, 200);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.set' && e.msg === 'passkey'));
});

test('changing a password takes the current one and signs out every other session', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const ip = '198.51.100.100';
  const a = (await login(h, 'Ana', GOOD, ip)).cookie;
  const b = (await login(h, 'Ana', GOOD, ip)).cookie;
  const next = 'a much better passphrase';
  assert.equal((await h.req('POST', '/api/account/password', { body: { next }, cookie: a, ip })).body.code, 'current-required');
  const wrong = await h.req('POST', '/api/account/password', { body: { next, current: 'not it at all' }, cookie: a, ip });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'current-wrong');
  const r = await h.req('POST', '/api/account/password', { body: { next, current: GOOD }, cookie: a, ip });
  assert.equal(r.status, 200);
  assert.equal(h.db().users[0].sv, 1);
  assert.equal((await h.req('GET', '/api/me', { cookie: b, ip })).status, 401, 'the other session ended');
  assert.equal((await h.req('GET', '/api/me', { cookie: r.cookie, ip })).status, 200, 'this one did not');
  assert.equal((await login(h, 'Ana', GOOD, ip)).status, 401);
  assert.equal((await login(h, 'Ana', next, ip)).status, 200);
});

// A sign-in with the old password that is still being checked when the password changes must not
// come back with a session: signed after the change, it would carry the new session version and
// outlive the "signed out everywhere" that the change is. Sign-ins every 20 ms from fresh addresses
// straddle the change; whatever cookie any of them got, none may still work afterwards. Run once
// with a current hash and once with one made at older parameters, whose sign-in rehashes — a
// second await before the cookie is signed.
for (const [label, stored] of [['current', () => pwHash], ['older parameters', () => oldHash]]) {
  test(`sign-ins with the old password still running during a change get no lasting session (${label} hash)`, async t => {
    pwHash ??= await hashPassword(GOOD);
    oldHash ??= await hashAt(GOOD, 14);
    const h = await startServer(t, { users: [user('u1', 'Ana', { pw: { h: stored(), set: new Date().toISOString() } })] });
    const owner = `gymsid=${mintSession('u1')}`;
    const next = 'a much better passphrase';
    const attempts = [];
    let change;
    for (let i = 0; i < 30; i++) {
      attempts.push(login(h, 'Ana', GOOD, `198.51.100.${10 + i}`));
      if (i === 3) change = h.req('POST', '/api/account/password', { body: { next, current: GOOD }, cookie: owner, ip: '203.0.113.200' });
      await new Promise(r => setTimeout(r, 20));
    }
    const done = await change;
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const answers = await Promise.all(attempts);
    for (const r of answers) assert.ok([200, 401, 429].includes(r.status), `status ${r.status}`);
    const cookies = answers.map(r => r.cookie).filter(Boolean);
    const alive = [];
    for (const cookie of cookies) if ((await h.req('GET', '/api/me', { cookie })).status === 200) alive.push(cookie);
    assert.equal(alive.length, 0, `${alive.length} of ${cookies.length} sessions signed with the old password survived the change`);
    assert.equal((await h.req('GET', '/api/me', { cookie: done.cookie })).status, 200, "the owner's own session carries on");
    assert.equal((await login(h, 'Ana', next, '203.0.113.201')).status, 200);
  });
}

test('sign-ins still running when an admin resets the password answer 401, not a server error', async t => {
  const h = await startServer(t, { env: { ADMIN_UIDS: 'adm' }, users: [user('adm', 'Root'), withPassword('u1', 'Ana')] });
  const attempts = Array.from({ length: 5 }, (_, i) => login(h, 'Ana', GOOD, `198.51.100.${60 + i}`));
  await new Promise(r => setTimeout(r, 30));
  const reset = await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u1' }, cookie: `gymsid=${mintSession('adm')}`, ip: '203.0.113.210' });
  assert.equal(reset.status, 200);
  const answers = await Promise.all(attempts);
  assert.ok(answers.some(r => r.status === 401), `none was still running: ${answers.map(r => r.status)}`);
  for (const r of answers) {
    assert.ok([200, 401].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.cookie) assert.equal((await h.req('GET', '/api/me', { cookie: r.cookie })).status, 401);
  }
  assert.doesNotMatch(h.log, /TypeError/);
});

test('wrong current passwords count toward the same pause as wrong sign-ins', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')] });
  const cookie = `gymsid=${mintSession('u1')}`;
  for (let i = 0; i < 6; i++) {
    await h.req('POST', '/api/account/password', { body: { next: 'a much better passphrase', current: 'guess number ' + i }, cookie, ip: `198.51.100.${110 + i}` });
  }
  assert.equal((await login(h, 'Ana', GOOD, '198.51.100.120')).status, 429);
});

test('the last way in is never removed', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana'), withPassword('u2', 'Bea')], creds: [key.row('u2')] });
  const ip = '198.51.100.130';
  // Refused before any proof is asked for: with the right password the answer is the same.
  const only = await h.req('DELETE', '/api/account/password', { body: { current: GOOD }, cookie: `gymsid=${mintSession('u1')}`, ip });
  assert.equal(only.status, 409);
  assert.equal(only.body.code, 'last-way-in');
  assert.equal((await login(h, 'Ana', GOOD, ip)).status, 200);
  const both = await h.req('DELETE', '/api/account/password', { body: { current: GOOD }, cookie: `gymsid=${mintSession('u2')}`, ip });
  assert.equal(both.status, 200);
  assert.equal((await login(h, 'Bea', GOOD, ip)).status, 401);
  assert.equal(h.db().users.find(u => u.id === 'u2').pw, undefined);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.remove' && e.uid === 'u2'));
  // Nothing left to remove: the same answer, no proof needed.
  assert.equal((await h.req('DELETE', '/api/account/password', { body: {}, cookie: `gymsid=${mintSession('u2')}`, ip })).status, 200);
});

// A stolen cookie must not take away the password that signs the owner in where passkeys do not
// work, so removing it takes the proof setting one does. Every refusal below leaves it working.
test('removing the password needs proof made for it: the password itself or a passkey assertion, nothing less', async t => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana'), user('u2', 'Bea')], creds: [key.row('u1'), other.row('u2')] });
  const cookie = `gymsid=${mintSession('u1')}`;
  const ip = '198.51.100.131';
  const stepUp = async (pk, challenge) => {
    const { cid, options } = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
    return { cid, credential: pk.assertion(challenge ?? options.challenge) };
  };
  const refused = async (body, code) => {
    const r = await h.req('DELETE', '/api/account/password', { body, cookie, ip });
    assert.equal(r.status, 403, JSON.stringify(body)?.slice(0, 60));
    assert.equal(r.body.code, code);
    assert.ok(h.db().users[0].pw?.h, 'the password is still set');
  };
  await refused(undefined, 'current-required');
  await refused({}, 'current-required');
  await refused({ current: 'not the password at all' }, 'current-wrong');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'password-remove' && e.uid === 'u1' && e.msg === 'bad-current'));
  // Bea's passkey, and an assertion over some other challenge than the one handed out.
  await refused(await stepUp(other), 'passkey');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'password-remove' && e.uid === 'u1' && e.msg === 'step-up-failed'));
  await refused(await stepUp(key, b64u(crypto.randomBytes(32))), 'passkey');
  // A sign-up's challenge, signed as if it were a sign-in's.
  const reg = (await h.req('POST', '/api/register/options', { body: { name: 'Mallory' }, ip })).body;
  await refused({ cid: reg.cid, credential: key.assertion(reg.options.challenge) }, 'passkey');
  // A proof that already signed someone in.
  const spent = await stepUp(key);
  assert.equal((await h.req('POST', '/api/login/verify', { body: spent, ip })).status, 200);
  await refused(spent, 'passkey');
  assert.equal((await login(h, 'Ana', GOOD, ip)).status, 200);
  assert.ok(!h.audit().some(e => e.ev === 'auth.password.remove'));

  const r = await h.req('DELETE', '/api/account/password', { body: await stepUp(key), cookie, ip });
  assert.equal(r.status, 200);
  assert.equal(h.db().users[0].pw, undefined);
  assert.equal((await login(h, 'Ana', GOOD, ip)).status, 401);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.remove' && e.uid === 'u1'));
  // Existing sessions are left alone.
  assert.equal((await h.req('GET', '/api/me', { cookie, ip })).status, 200);
});

test('wrong passwords given to remove the password count toward the same pause as wrong sign-ins', async t => {
  const key = softPasskey();
  const h = await startServer(t, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
  const cookie = `gymsid=${mintSession('u1')}`;
  const answers = [];
  for (let i = 0; i < 7; i++) {
    answers.push(await h.req('DELETE', '/api/account/password', { body: { current: 'guess number ' + i }, cookie, ip: `198.51.100.${140 + i}` }));
  }
  assert.deepEqual(answers.map(r => r.status), [403, 403, 403, 403, 403, 403, 429]);
  assert.ok(h.audit().some(e => e.ev === 'auth.password.locked' && e.uid === 'u1'));
  assert.equal((await login(h, 'Ana', GOOD, '198.51.100.150')).status, 429);
  assert.equal((await h.req('DELETE', '/api/account/password', { body: { current: GOOD }, cookie, ip: '198.51.100.151' })).status, 429);
  assert.ok(h.db().users[0].pw?.h);
});

test('an admin reset: a one-time code that ends the old password, works once, and expires', async t => {
  const h = await startServer(t, {
    env: { ADMIN_UIDS: 'adm' },
    users: [
      user('adm', 'Root'), withPassword('u1', 'Ana'), user('u2', 'Bea', { disabled: true }), withPassword('adm2', 'Other', { admin: true }),
      user('u3', 'Cleo', { pwReset: { h: hashResetCode('AAAA-BBBB-CCCC'), exp: Date.now() - 1000, by: 'adm' } })
    ]
  });
  const ip = '198.51.100.140';
  const admin = `gymsid=${mintSession('adm')}`;
  const session = (await login(h, 'Ana', GOOD, ip)).cookie;

  assert.equal((await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u1' }, cookie: session, ip })).status, 403);
  assert.equal((await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'adm2' }, cookie: admin, ip })).status, 400);
  const issued = await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u1' }, cookie: admin, ip });
  assert.equal(issued.status, 200);
  const { code } = issued.body;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(issued.body.expires > Date.now() + 23 * 3600000);
  const stored = h.db().users.find(u => u.id === 'u1');
  assert.equal(JSON.stringify(stored).includes(code), false, 'only a hash of the code is kept');
  assert.equal(stored.pw, undefined);
  // The old password and the old session are both gone.
  assert.equal((await login(h, 'Ana', GOOD, ip)).status, 401);
  assert.equal((await h.req('GET', '/api/me', { cookie: session, ip })).status, 401);

  const redeem = (body, from = ip) => h.req('POST', '/api/login/password-reset', { body, ip: from });
  assert.equal((await redeem({ name: 'Ana', code: 'ZZZZ-ZZZZ-ZZZZ', next: 'a brand new passphrase' })).body.code, 'reset-invalid');
  // A weak new password is refused without using up the code.
  assert.equal((await redeem({ name: 'Ana', code, next: 'short' })).body.code, 'too-short');
  const r = await redeem({ name: 'ana', code: code.toLowerCase().replace(/-/g, ' '), next: 'a brand new passphrase' });
  assert.equal(r.status, 200);
  assert.ok(r.cookie);
  assert.equal((await h.req('GET', '/api/me', { cookie: r.cookie, ip })).status, 200);
  assert.equal((await redeem({ name: 'Ana', code, next: 'another new passphrase' })).body.code, 'reset-invalid', 'single use');
  assert.equal((await login(h, 'Ana', 'a brand new passphrase', ip)).status, 200);
  // Expired, and a disabled account.
  assert.equal((await redeem({ name: 'Cleo', code: 'AAAA-BBBB-CCCC', next: 'a brand new passphrase' })).body.code, 'reset-invalid');
  const bea = (await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u2' }, cookie: admin, ip })).body.code;
  assert.equal((await redeem({ name: 'Bea', code: bea, next: 'a brand new passphrase' })).status, 403);

  const evs = h.audit().map(e => e.ev);
  assert.ok(evs.includes('admin.password.reset'));
  assert.ok(h.audit().some(e => e.ev === 'auth.password.reset' && e.ok && e.uid === 'u1'));
  assert.ok(h.audit().some(e => e.ev === 'auth.password.reset' && !e.ok));
});

// The reset removes the old password at once, so for the day the code is valid the profile has
// none — and a name only counted as taken by a password would be free for anyone to take, leaving
// the code unredeemable (there is no rename) and the profile locked out.
test('a pending reset keeps the name: nobody can take it until the code is used or expires', async t => {
  const key = softPasskey();
  const h = await startServer(t, {
    env: { ADMIN_UIDS: 'adm' },
    users: [
      user('adm', 'Root'), withPassword('u1', 'Ana'), user('u2', 'ANA '), user('u3', 'Cleo'), user('u4', 'Dora'),
      user('u5', 'Cleo', { pwReset: { h: hashResetCode('AAAA-BBBB-CCCC'), exp: Date.now() - 1000, by: 'adm' } })
    ],
    creds: [key.row('u2')]
  });
  const admin = `gymsid=${mintSession('adm')}`;
  const ip = '198.51.100.240';
  const { code } = (await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u1' }, cookie: admin, ip })).body;

  // Registering the name, and another profile of that name setting a first password, are refused.
  const squat = await h.req('POST', '/api/register/password', { body: { name: 'ana', password: GOOD }, ip });
  assert.equal(squat.status, 409);
  assert.equal(squat.body.code, 'name-taken');
  const other = `gymsid=${mintSession('u2')}`;
  assert.equal((await h.req('GET', '/api/account/password', { cookie: other, ip })).body.nameTaken, true);
  const { cid, options } = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const first = await h.req('POST', '/api/account/password', { body: { next: GOOD, cid, credential: key.assertion(options.challenge) }, cookie: other, ip });
  assert.equal(first.status, 409);
  // Nor can a second reset hand the name to the other profile.
  assert.equal((await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u2' }, cookie: admin, ip })).status, 409);

  // The code still works, and the name is Ana's again.
  const r = await h.req('POST', '/api/login/password-reset', { body: { name: 'Ana', code, next: 'a brand new passphrase' }, ip });
  assert.equal(r.status, 200);
  assert.equal((await login(h, 'ana', 'a brand new passphrase', ip)).status, 200);
  assert.equal(h.db().users.filter(u => u.pw && u.name.trim().toLowerCase() === 'ana').length, 1);

  // An expired code holds nothing: that name is free.
  assert.equal((await h.req('POST', '/api/register/password', { body: { name: 'cleo', password: GOOD }, ip })).status, 200);
});

test('registering a name while its reset code is redeemed leaves one password holder, the reset profile', async t => {
  const h = await startServer(t, { env: { ADMIN_UIDS: 'adm' }, users: [user('adm', 'Root'), withPassword('u1', 'Bob')] });
  const { code } = (await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u1' }, cookie: `gymsid=${mintSession('adm')}`, ip: '198.51.100.241' })).body;
  const [reg, redeem] = await Promise.all([
    h.req('POST', '/api/register/password', { body: { name: 'BOB', password: GOOD }, ip: '198.51.100.242' }),
    h.req('POST', '/api/login/password-reset', { body: { name: 'bob', code, next: 'a brand new passphrase' }, ip: '198.51.100.243' })
  ]);
  assert.equal(redeem.status, 200);
  assert.equal(reg.status, 409);
  const holders = h.db().users.filter(u => u.pw && u.name.toLowerCase() === 'bob');
  assert.deepEqual(holders.map(u => u.id), ['u1']);
  assert.equal((await login(h, 'Bob', 'a brand new passphrase', '198.51.100.244')).status, 200);
});

// A 60-bit code that lives a day needs no per-name pause, and one would let anyone who knows the
// name keep the real code refused for that whole day. Wrong codes count against the address only.
test('wrong reset codes for a name do not lock out its real code, and do not touch the password count', async t => {
  const h = await startServer(t, {
    // No activity log: ten thousand lines of it below would only slow the test down.
    env: { ADMIN_UIDS: 'adm', AUDIT_LOG: '0' },
    users: [user('adm', 'Root'), withPassword('u1', 'Ana'), withPassword('u2', 'Bea')]
  });
  const { code } = (await h.req('POST', '/api/admin/user/password-reset', { body: { id: 'u2' }, cookie: `gymsid=${mintSession('adm')}`, ip: '198.51.100.245' })).body;
  for (let i = 0; i < 12; i++) {
    const r = await h.req('POST', '/api/login/password-reset', { body: { name: 'Bea', code: 'ZZZZ-ZZZZ-ZZZ' + i, next: 'whatever passphrase' }, ip: `198.51.100.${100 + i}` });
    assert.equal(r.body.code, 'reset-invalid');
  }
  assert.equal((await h.req('POST', '/api/login/password-reset', { body: { name: 'Bea', code, next: 'a brand new passphrase' }, ip: '198.51.100.246' })).status, 200);

  // The cheap flood of the probe: five wrong passwords for Ana, then ten thousand junk codes for
  // names nobody has, twenty per IPv6 /64 so no address is paused. Ana's count is still there.
  for (let i = 0; i < 5; i++) assert.equal((await login(h, 'Ana', 'wrong password ' + i, `198.51.100.${150 + i}`)).status, 401);
  // Kept-alive connections: a fresh one per request would make this the slowest test in the file.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 50 });
  t.after(() => agent.destroy());
  const junk = i => new Promise((resolve, reject) => {
    const r = http.request(`${h.api}/api/login/password-reset`, {
      method: 'POST', agent,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': `2001:db8:${(i / 20 | 0).toString(16)}::1` }
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(JSON.stringify({ name: 'junk' + i, code: 'ZZZZ-ZZZZ-ZZZZ', next: 'whatever passphrase' }));
  });
  for (let i = 0; i < 10000; i += 200) {
    const batch = await Promise.all(Array.from({ length: 200 }, (_, j) => junk(i + j)));
    assert.ok(batch.every(status => status === 400), 'no junk request was paused');
  }
  assert.equal((await login(h, 'Ana', 'wrong password 5', '198.51.100.160')).status, 401);
  assert.equal((await login(h, 'Ana', GOOD, '198.51.100.161')).status, 429, 'the sixth wrong password paused the name');
});

test('a disabled account is refused even with the right password', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana', { disabled: true })] });
  const r = await login(h, 'Ana', GOOD, '198.51.100.150');
  assert.equal(r.status, 403);
  assert.equal(r.cookie, null);
});
