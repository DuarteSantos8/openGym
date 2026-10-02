/* The sign-in e-mail next to the profile name (password sign-in, #118): set, changed and removed
   only with the owner's proof, unique across profiles, typed at sign-in and at a reset in place of
   the name — with the same pause behind both — and never written out in full anywhere but the
   owner's own account row and the admin's user list. Same harness as server-password.test.js. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword, hashResetCode, normalizeEmail, maskEmail } from '../password.js';
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

const signIn = (h, body, ip) => h.req('POST', '/api/login/password', { body, ip });
const setEmail = (h, cookie, body, ip) => h.req('POST', '/api/account/email', { body, cookie, ip });
const WRONG = { error: 'wrong name or password', code: 'bad-credentials' };
// Nothing in the audit log, the process output or db.json's neighbours may carry the address.
const leaks = (h, needle) => {
  const audit = (() => { try { return fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'); } catch { return ''; } })();
  return audit.toLowerCase().includes(needle) || h.log.toLowerCase().includes(needle);
};

test('normalizeEmail folds and checks the way sign-in compares; maskEmail keeps two characters', () => {
  assert.equal(normalizeEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(normalizeEmail('ａｄａ@example.com'), 'ada@example.com');   // NFKC, like names
  assert.equal(normalizeEmail('a.b+gym@sub.example.org'), 'a.b+gym@sub.example.org');
  for (const bad of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'ada@.com', 'ada@ex..com', 'a da@example.com', 'ada@@example.com', 'x'.repeat(250) + '@ex.com', 42, null])
    assert.equal(normalizeEmail(bad), null, String(bad));
  assert.equal(normalizeEmail('a@' + 'b'.repeat(245) + '.com'), 'a@' + 'b'.repeat(245) + '.com');   // 251 characters
  assert.equal(maskEmail('ada@example.com'), 'a…@e…');
});

test('with PASSWORD_LOGIN off the e-mail routes are 404s, sign-in by e-mail too, and admins see no address', async t => {
  const h = await startServer(t, {
    env: { PASSWORD_LOGIN: '', ADMIN_UIDS: 'adm' },
    users: [user('adm', 'Root'), withPassword('u1', 'Ana', { email: 'ana@example.com' })]
  });
  const cookie = `gymsid=${mintSession('u1')}`;
  assert.equal((await setEmail(h, cookie, { email: 'new@example.com', current: GOOD })).status, 404);
  assert.equal((await h.req('DELETE', '/api/account/email', { body: { current: GOOD }, cookie })).status, 404);
  assert.equal((await signIn(h, { email: 'ana@example.com', password: GOOD })).status, 404);
  const list = await h.req('GET', '/api/admin/users', { cookie: `gymsid=${mintSession('adm')}` });
  assert.equal(list.status, 200);
  assert.ok(list.body.users.every(u => !('email' in u)));
  const one = await h.req('GET', '/api/admin/user?id=u1', { cookie: `gymsid=${mintSession('adm')}` });
  assert.equal('email' in one.body.user, false);
  // The stored address stays where it is for when the flag comes back.
  assert.equal(h.db().users.find(u => u.id === 'u1').email, 'ana@example.com');
});

test('signs in by e-mail in any of the three fields, case-insensitively; the name still works', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' })] });
  for (const [i, body] of [
    { identifier: '  ANA@Example.com ', password: GOOD },
    { name: 'Ana@EXAMPLE.com', password: GOOD },          // an older app sends everything as `name`
    { email: 'ana@example.com', password: GOOD },
    { identifier: 'ana', password: GOOD },
    { name: 'ANA', password: GOOD }
  ].entries()) {
    const r = await signIn(h, body, `198.51.100.${10 + i}`);
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(r.body.user, { id: 'u1', name: 'Ana', admin: false, avatar: null, shareBodyWeight: true });
    assert.ok(r.cookie);
  }
  // `email` means an address and nothing else: the name typed there is not looked up.
  assert.deepEqual((await signIn(h, { email: 'Ana', password: GOOD }, '198.51.100.20')).body, WRONG);
  // The session answers carry no address.
  const me = await h.req('GET', '/api/me', { cookie: (await signIn(h, { identifier: 'ana@example.com', password: GOOD }, '198.51.100.21')).cookie });
  assert.equal(JSON.stringify(me.body).includes('example.com'), false);
});

test('a wrong password, an unknown address and an address without a password get the one answer; nothing logs the address', async t => {
  const h = await startServer(t, {
    users: [withPassword('u1', 'Ana', { email: 'ana@example.com' }), user('u2', 'Bea', { email: 'bea@example.com' })]
  });
  for (const [i, identifier] of ['ana@example.com', 'nobody@example.com', 'bea@example.com'].entries()) {
    const r = await signIn(h, { identifier, password: 'not the password at all' }, `198.51.100.${30 + i}`);
    assert.equal(r.status, 401, identifier);
    assert.deepEqual(r.body, WRONG);
  }
  const fails = h.audit().filter(e => e.ev === 'auth.password.fail');
  assert.ok(fails.some(e => e.uid === 'u1' && e.msg === 'bad-password'));
  assert.equal(fails.filter(e => e.msg === 'unknown-email').length, 2);
  assert.equal(leaks(h, 'example.com'), false);
});

test('a profile name with an "@" in it still signs in by name', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'dj@home.club')] });
  const r = await signIn(h, { identifier: 'DJ@home.club', password: GOOD }, '198.51.100.40');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 'u1');
});

test('wrong passwords by name and by e-mail count against the one account: switching does not reset the pause', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' })] });
  for (let i = 0; i < 3; i++) assert.equal((await signIn(h, { identifier: 'Ana', password: 'wrong ' + i }, `198.51.100.${50 + i}`)).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await signIn(h, { identifier: 'ana@example.com', password: 'wrong ' + i }, `198.51.100.${60 + i}`)).status, 401);
  // Six wrong in all: the account is paused however it is named, the right password included.
  for (const body of [{ identifier: 'ana', password: GOOD }, { email: 'ANA@example.com', password: GOOD }, { name: 'ana@example.com', password: GOOD }]) {
    const r = await signIn(h, body, '198.51.100.70');
    assert.equal(r.status, 429, JSON.stringify(body));
    assert.equal(r.body.code, 'locked');
  }
  assert.ok(h.audit().some(e => e.ev === 'auth.password.locked' && e.uid === 'u1'));
  // An address nobody has is paused the same way on its own, as typed — and pauses nobody else.
  const h2 = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' })] });
  for (let i = 0; i < 6; i++) await signIn(h2, { identifier: 'ghost@example.com', password: 'wrong ' + i }, `198.51.100.${80 + i}`);
  assert.equal((await signIn(h2, { identifier: 'GHOST@example.com', password: GOOD }, '198.51.100.90')).status, 429);
  assert.equal((await signIn(h2, { identifier: 'ana@example.com', password: GOOD }, '198.51.100.91')).status, 200);
});

test('a wrong current password given to change the address counts toward the same account pause', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' })] });
  const cookie = `gymsid=${mintSession('u1')}`;
  for (let i = 0; i < 6; i++) {
    const r = await setEmail(h, cookie, { email: 'other@example.com', current: 'wrong ' + i }, `198.51.100.${100 + i}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'current-wrong');
  }
  assert.equal((await signIn(h, { identifier: 'ana@example.com', password: GOOD }, '198.51.100.110')).status, 429);
});

test('setting, changing and removing the address needs the owner’s proof, never the session alone', async t => {
  const pk = softPasskey();
  const h = await startServer(t, {
    users: [withPassword('u1', 'Ana'), user('u2', 'Bea')],
    creds: [pk.row('u2')]
  });
  const ana = `gymsid=${mintSession('u1')}`;
  const bea = `gymsid=${mintSession('u2')}`;
  assert.equal((await h.req('POST', '/api/account/email', { body: { email: 'ana@example.com' } })).status, 401);
  let r = await setEmail(h, ana, { email: 'ana@example.com' }, '198.51.100.120');
  assert.equal(r.status, 403); assert.equal(r.body.code, 'current-required');
  r = await setEmail(h, ana, { email: 'ana@example.com', current: 'not it at all' }, '198.51.100.121');
  assert.equal(r.status, 403); assert.equal(r.body.code, 'current-wrong');
  assert.equal(h.db().users.find(u => u.id === 'u1').email, undefined);
  r = await setEmail(h, ana, { email: ' Ana@Example.com ', current: GOOD }, '198.51.100.122');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, email: 'ana@example.com' });
  assert.equal(h.db().users.find(u => u.id === 'u1').email, 'ana@example.com');
  // The same address again is no change and asks for nothing.
  assert.equal((await setEmail(h, ana, { email: 'ANA@example.com' }, '198.51.100.123')).status, 200);
  // Changing it asks again.
  assert.equal((await setEmail(h, ana, { email: 'ana2@example.com' }, '198.51.100.124')).status, 403);
  assert.equal((await setEmail(h, ana, { email: 'ana2@example.com', current: GOOD }, '198.51.100.125')).status, 200);
  const status = await h.req('GET', '/api/account/password', { cookie: ana });
  assert.equal(status.body.email, 'ana2@example.com');
  // Invalid addresses are refused before any proof is asked.
  r = await setEmail(h, ana, { email: 'not an address', current: GOOD }, '198.51.100.126');
  assert.equal(r.status, 400); assert.equal(r.body.code, 'email-invalid');
  r = await setEmail(h, ana, { email: 'a@' + 'b'.repeat(260) + '.com', current: GOOD }, '198.51.100.126');
  assert.equal(r.body.code, 'email-invalid');

  // Removing: the session alone is refused, by DELETE and by an empty address alike.
  assert.equal((await h.req('DELETE', '/api/account/email', { body: {}, cookie: ana, ip: '198.51.100.127' })).status, 403);
  assert.equal((await setEmail(h, ana, { email: '' }, '198.51.100.128')).status, 403);
  assert.equal(h.db().users.find(u => u.id === 'u1').email, 'ana2@example.com');
  r = await h.req('DELETE', '/api/account/email', { body: { current: GOOD }, cookie: ana, ip: '198.51.100.129' });
  assert.deepEqual(r.body, { ok: true, email: null });
  assert.equal('email' in h.db().users.find(u => u.id === 'u1'), false);

  // A profile with no password confirms with one of its passkeys; without one it is told to.
  r = await setEmail(h, bea, { email: 'bea@example.com' }, '198.51.100.130');
  assert.equal(r.status, 403); assert.equal(r.body.code, 'passkey-required');
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  r = await setEmail(h, bea, { email: 'bea@example.com', cid: opts.body.cid, credential: pk.assertion(opts.body.options.challenge) }, '198.51.100.131');
  assert.equal(r.status, 200);
  assert.equal(h.db().users.find(u => u.id === 'u2').email, 'bea@example.com');

  // The log says what happened and with which proof, with the address masked.
  const evs = h.audit().filter(e => e.ev.startsWith('auth.email.'));
  assert.deepEqual(evs.filter(e => e.ok).map(e => [e.ev, e.uid, e.msg]), [
    ['auth.email.set', 'u1', 'password · a…@e…'],
    ['auth.email.change', 'u1', 'password · a…@e…'],
    ['auth.email.remove', 'u1', 'password'],
    ['auth.email.set', 'u2', 'passkey · b…@e…']
  ]);
  assert.equal(leaks(h, 'example.com'), false);
});

test('an address is unique across profiles, case-insensitively, and never another password holder’s name', async t => {
  const h = await startServer(t, {
    users: [withPassword('u1', 'Ana', { email: 'ana@example.com' }), withPassword('u2', 'Bea'), withPassword('u3', 'dj@home.club'), user('u4', 'Cy', { email: 'cy@example.com' })]
  });
  const bea = `gymsid=${mintSession('u2')}`;
  for (const [i, email] of ['ANA@example.com', 'DJ@home.club', 'cy@example.com'].entries()) {
    const r = await setEmail(h, bea, { email, current: GOOD }, `198.51.100.${140 + i}`);
    assert.equal(r.status, 409, email);
    assert.deepEqual(r.body, { error: 'another profile already uses this e-mail address', code: 'email-taken' });
  }
  assert.equal(h.db().users.find(u => u.id === 'u2').email, undefined);
  assert.ok(h.audit().some(e => e.ev === 'auth.email.fail' && e.uid === 'u2' && e.msg === 'email-taken'));
  // The other way round: a profile whose name is someone's address cannot take a password.
  const h2 = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' }), user('u2', 'ana@example.com')] });
  const opts = await h2.req('GET', '/api/account/password', { cookie: `gymsid=${mintSession('u2')}` });
  assert.equal(opts.body.nameTaken, true);
  // Signing up with an address in use, or a name that is one, is refused the same way.
  let r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email: 'Ana@Example.com' }, ip: '198.51.100.150' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'email-taken');
  r = await h.req('POST', '/api/register/password', { body: { name: 'ana@example.com', password: GOOD }, ip: '198.51.100.151' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'name-taken');
  r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email: 'nope' }, ip: '198.51.100.152' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'email-invalid');
  assert.equal(h.db().users.length, 4);
  // A free one is stored folded, and signs the new profile in straight away.
  r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email: ' Dee@Example.com ' }, ip: '198.51.100.153' });
  assert.equal(r.status, 200);
  assert.equal(h.db().users.find(u => u.name === 'Dee').email, 'dee@example.com');
  assert.equal((await signIn(h, { identifier: 'dee@example.com', password: GOOD }, '198.51.100.154')).status, 200);
  assert.equal(leaks(h, 'example.com'), false);
});

test('on an invite-only instance signup says nothing about addresses without a valid invite, and a refusal keeps the invite', async t => {
  const now = new Date().toISOString();
  const h = await startServer(t, {
    env: { INVITE_ONLY: '1' },
    users: [withPassword('u1', 'Ana', { email: 'ana@example.com' })],
    invites: [{ code: 'GOODCODE', created: now }, { code: 'USEDCODE', created: now, usedBy: 'u1' }, { code: 'GONECODE', created: now, revoked: true }]
  });
  // No code, a wrong one, a used one and a revoked one: the answer is about the invite, the
  // same for an address in use as for a free one, and nothing counts against "email".
  for (const [i, code] of ['', 'NOPE', 'USEDCODE', 'GONECODE'].entries()) {
    for (const email of ['ana@example.com', 'free@example.com']) {
      const r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email, code }, ip: `198.51.100.${170 + i}` });
      assert.equal(r.status, 403, `${code} ${email}`);
      assert.equal(r.body.code, 'invite');
    }
  }
  assert.equal(h.audit().some(e => e.msg === 'email-taken'), false);
  // With a valid code the address in use is refused, and the code is still there to use.
  let r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email: 'ANA@example.com', code: 'goodcode' }, ip: '198.51.100.180' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'email-taken');
  assert.equal(h.db().invites.find(i => i.code === 'GOODCODE').usedBy, undefined);
  r = await h.req('POST', '/api/register/password', { body: { name: 'Dee', password: GOOD, email: 'dee@example.com', code: 'GOODCODE' }, ip: '198.51.100.181' });
  assert.equal(r.status, 200);
  assert.equal(h.db().invites.find(i => i.code === 'GOODCODE').usedBy, h.db().users.find(u => u.name === 'Dee').id);
});

test('asking over and over whether an address is in use runs into a pause', async t => {
  const h = await startServer(t, { users: [withPassword('u1', 'Ana', { email: 'ana@example.com' }), withPassword('u2', 'Bea')] });
  const bea = `gymsid=${mintSession('u2')}`;
  const ip = '203.0.113.60';
  // Twenty answers are free; the twenty-first starts the pause for the address and the account.
  for (let i = 0; i < 21; i++) assert.equal((await setEmail(h, bea, { email: 'ana@example.com', current: GOOD }, ip)).status, 409, 'try ' + i);
  let r = await setEmail(h, bea, { email: 'ana@example.com', current: GOOD }, ip);
  assert.equal(r.status, 429); assert.equal(r.body.code, 'locked');
  // Another address of the same account is paused too, before any proof is checked.
  r = await setEmail(h, bea, { email: 'ana@example.com', current: GOOD }, '203.0.113.61');
  assert.equal(r.status, 429);
  // Sign-in is not what was paused.
  assert.equal((await signIn(h, { identifier: 'bea', password: GOOD }, ip)).status, 200);
});

test('a reset code is redeemed with the e-mail as well as with the name', async t => {
  const code = 'K7WQ-2MZP-4HXA';
  const reset = () => ({ h: hashResetCode(code), exp: Date.now() + 3600000, by: 'adm' });
  const h = await startServer(t, { users: [user('u1', 'Ana', { email: 'ana@example.com', pwReset: reset() })] });
  const r = await h.req('POST', '/api/login/password-reset', { body: { identifier: 'ANA@example.com', code: code.toLowerCase(), next: 'a brand new passphrase' }, ip: '198.51.100.160' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 'u1');
  assert.equal(h.db().users[0].email, 'ana@example.com');
  assert.equal((await signIn(h, { identifier: 'ana@example.com', password: 'a brand new passphrase' }, '198.51.100.161')).status, 200);
  const h2 = await startServer(t, { users: [user('u1', 'Ana', { email: 'ana@example.com', pwReset: reset() })] });
  assert.equal((await h2.req('POST', '/api/login/password-reset', { body: { name: 'ana', code, next: 'a brand new passphrase' }, ip: '198.51.100.162' })).status, 200);
});

test('the admin user list and drill-down show the address to admins only', async t => {
  const h = await startServer(t, {
    env: { ADMIN_UIDS: 'adm' },
    users: [user('adm', 'Root'), withPassword('u1', 'Ana', { email: 'ana@example.com' }), withPassword('u2', 'Bea')]
  });
  const adm = `gymsid=${mintSession('adm')}`;
  const list = await h.req('GET', '/api/admin/users', { cookie: adm });
  assert.equal(list.body.users.find(u => u.id === 'u1').email, 'ana@example.com');
  assert.equal(list.body.users.find(u => u.id === 'u2').email, null);
  const one = await h.req('GET', '/api/admin/user?id=u1', { cookie: adm });
  assert.equal(one.body.user.email, 'ana@example.com');
  for (const p of ['/api/admin/users', '/api/admin/user?id=u1']) {
    const r = await h.req('GET', p, { cookie: `gymsid=${mintSession('u2')}` });
    assert.equal(r.status, 403, p);
    assert.equal(JSON.stringify(r.body).includes('example.com'), false);
  }
});
