/* The first-run onboarding's openGym routes: the invite check that never uses an invite up, invite
   expiry and single use at sign-up, the migration of invites from before expiry, and the passkey
   backup flags (BE/BS) behind `synced` in /api/me. Real server.js in a child, the harness of
   server-passkeys.test.js; every test talks from its own X-Forwarded-For address (TRUST_PROXY=1). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { softPasskey, FLAGS, ORIGIN } from './soft-passkey.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const DAY = 86400000;

const mintSession = uid => {
  const payload = `${uid}:${Date.now() + DAY}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const ADMIN = user('adm', 'Adrian', { admin: true });

async function startServer(t, { users = [ADMIN], creds = [], invites = [], env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-inv-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost',
      INVITE_ONLY: '1', TRUST_PROXY: '1', PASSWORD_LOGIN: '1', ADMIN_UIDS: '', AUDIT_LOG: '', ...env
    }
  });
  const h = { log: '' };
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
  // The passkey sign-up the app runs: options with the name and code, then the attestation.
  h.signUp = async (key, { name = 'Ana', code, ip } = {}) => {
    const opt = await h.req('POST', '/api/register/options', { body: { name, code }, ip });
    if (opt.status !== 200) return opt;
    return h.req('POST', '/api/register/verify', { body: { cid: opt.body.cid, credential: key.attestation(opt.body.options.challenge) }, ip });
  };
  h.signIn = async (key, ip) => {
    const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
    return h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: key.assertion(lo.options.challenge) }, ip });
  };
  h.newInvite = async body => (await h.req('POST', '/api/admin/invites/new', { body, cookie: mintSession('adm') })).body.invite;
  return h;
}

const iso = ms => new Date(ms).toISOString();
const invite = (code, extra = {}) => ({ code, note: '', createdBy: 'adm', created: iso(Date.now()), expiresAt: iso(Date.now() + 14 * DAY), ...extra });

test('the check answers who invited and the suggested name, needs no session, and never uses the invite up', async t => {
  const h = await startServer(t);
  const inv = await h.newInvite({ note: 'for my sister', name: ' Ana ' });
  assert.equal(inv.name, 'Ana');
  const expires = Date.parse(inv.expiresAt) - Date.parse(inv.created);
  assert.equal(expires, 14 * DAY, 'an invite works for fourteen days');

  for (let i = 0; i < 3; i++) {
    const r = await h.req('GET', `/api/invites/${inv.code.toLowerCase()}`, { ip: '198.51.100.10', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'valid', inviterName: 'Adrian', suggestedName: 'Ana' });
    assert.ok(!JSON.stringify(r.body).includes('sister'), 'the note is the inviter’s own');
  }
  const row = h.db().invites.find(i => i.code === inv.code);
  assert.equal(row.usedBy, undefined, 'checking used nothing up');

  // Still good for the sign-up it was made for, and then it is used.
  const key = softPasskey();
  const done = await h.signUp(key, { code: inv.code, ip: '198.51.100.10' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const after = await h.req('GET', `/api/invites/${inv.code}`, { ip: '198.51.100.10' });
  assert.deepEqual(after.body, { status: 'used', inviterName: null, suggestedName: null }, 'a spent code names nobody');
});

test('the audit log never holds a live code, and no log line carries one', async t => {
  const h = await startServer(t, { env: { AUDIT_LOG: '1' } });
  const inv = await h.newInvite({ name: 'Ana' });
  await h.req('GET', `/api/invites/${inv.code}`, { ip: '198.51.100.11' });
  await h.req('GET', '/api/invites/NOPE0000NOPE0000', { ip: '198.51.100.11' });
  await h.req('POST', '/api/admin/invites/revoke', { body: { code: inv.code }, cookie: mintSession('adm') });
  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'admin.invite.create' && e.msg === `${inv.code.slice(0, 4)}…`), JSON.stringify(audit));
  assert.ok(audit.some(e => e.ev === 'admin.invite.revoke'));
  assert.ok(!JSON.stringify(audit).includes(inv.code), 'the audit log');
  assert.ok(!h.log.includes(inv.code) && !h.log.includes('NOPE0000NOPE0000'), 'the container log');
});

test('an invite works once', async t => {
  const h = await startServer(t, { invites: [invite('ONCE0000ONCE0000')] });
  assert.equal((await h.signUp(softPasskey(), { name: 'Ana', code: 'ONCE0000ONCE0000', ip: '198.51.100.20' })).status, 200);
  const second = await h.signUp(softPasskey(), { name: 'Eve', code: 'ONCE0000ONCE0000', ip: '198.51.100.20' });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'invite');
  const pw = await h.req('POST', '/api/register/password', { body: { name: 'Eve', password: 'correct horse battery staple', code: 'ONCE0000ONCE0000' }, ip: '198.51.100.20' });
  assert.deepEqual([pw.status, pw.body.code], [403, 'invite']);
  assert.equal(h.db().users.length, 2);
});

test('an expired invite is refused at every way to sign up, and the check says expired', async t => {
  const old = invite('LATE0000LATE0000', { created: iso(Date.now() - 15 * DAY), expiresAt: iso(Date.now() - DAY), name: 'Ana' });
  const h = await startServer(t, { invites: [old] });
  const check = await h.req('GET', '/api/invites/LATE0000LATE0000', { ip: '198.51.100.30' });
  assert.deepEqual(check.body, { status: 'expired', inviterName: null, suggestedName: null });
  const passkey = await h.req('POST', '/api/register/options', { body: { name: 'Ana', code: 'LATE0000LATE0000' }, ip: '198.51.100.30' });
  assert.deepEqual([passkey.status, passkey.body.code], [403, 'invite']);
  const pw = await h.req('POST', '/api/register/password', { body: { name: 'Ana', password: 'correct horse battery staple', code: 'LATE0000LATE0000' }, ip: '198.51.100.30' });
  assert.deepEqual([pw.status, pw.body.code], [403, 'invite']);
  assert.equal(h.db().users.length, 1);
});

test('an invite that expires between the passkey prompt and its answer is refused at the answer', async t => {
  const h = await startServer(t, { invites: [invite('EDGE0000EDGE0000', { expiresAt: iso(Date.now() + 1500) })] });
  const ip = '198.51.100.31';
  const opt = await h.req('POST', '/api/register/options', { body: { name: 'Ana', code: 'EDGE0000EDGE0000' }, ip });
  assert.equal(opt.status, 200);
  await new Promise(r => setTimeout(r, 1600));
  const ver = await h.req('POST', '/api/register/verify', { body: { cid: opt.body.cid, credential: softPasskey().attestation(opt.body.options.challenge) }, ip });
  assert.equal(ver.status, 403);
  assert.equal(h.db().users.length, 1);
});

test('invites from before expiry get fourteen days from the update, and keep working', async t => {
  const longAgo = iso(Date.now() - 200 * DAY);
  const before = Date.now();
  const h = await startServer(t, {
    invites: [
      { code: 'AAAA0000AAAA0000', note: 'old', createdBy: 'adm', created: longAgo },
      { code: 'BBBB0000BBBB0000', note: '', createdBy: 'adm', created: longAgo, usedBy: 'adm', usedAt: longAgo }
    ]
  });
  const after = Date.now();
  const [a, b] = h.db().invites;
  for (const inv of [a, b]) {
    const exp = Date.parse(inv.expiresAt);
    assert.ok(exp >= before + 14 * DAY - 1000 && exp <= after + 14 * DAY, `${inv.code} expires fourteen days after the boot`);
  }
  assert.equal((await h.req('GET', '/api/invites/AAAA0000AAAA0000', { ip: '198.51.100.40' })).body.status, 'valid');
  assert.equal((await h.req('GET', '/api/invites/BBBB0000BBBB0000', { ip: '198.51.100.40' })).body.status, 'used');
  assert.equal((await h.signUp(softPasskey(), { code: 'AAAA0000AAAA0000', ip: '198.51.100.40' })).status, 200);
});

test('a revoked invite stays on record for the check, leaves the admin list and signs nobody up', async t => {
  const h = await startServer(t, { invites: [invite('GONE0000GONE0000', { name: 'Ana' }), invite('KEEP0000KEEP0000')] });
  const admin = mintSession('adm');
  assert.equal((await h.req('POST', '/api/admin/invites/revoke', { body: { code: 'gone0000gone0000' }, cookie: admin })).status, 200);
  assert.deepEqual((await h.req('GET', '/api/invites/GONE0000GONE0000', { ip: '198.51.100.50' })).body, { status: 'revoked', inviterName: null, suggestedName: null });
  const list = await h.req('GET', '/api/admin/invites', { cookie: admin });
  assert.deepEqual(list.body.invites.map(i => [i.code, i.status]), [['KEEP0000KEEP0000', 'valid']]);
  assert.equal((await h.signUp(softPasskey(), { code: 'GONE0000GONE0000', ip: '198.51.100.50' })).status, 403);
  assert.equal((await h.req('POST', '/api/admin/invites/revoke', { body: { code: 'GONE0000GONE0000' }, cookie: admin })).status, 404, 'revoking twice');
  const row = h.db().invites.find(i => i.code === 'GONE0000GONE0000');
  assert.equal(row.revoked, true);
  assert.ok(row.revokedAt);
});

test('an unknown or malformed code is a plain 404, and the check is rate limited per address', async t => {
  const h = await startServer(t, { invites: [invite('RATE0000RATE0000')] });
  for (const p of ['/api/invites/NOPE0000NOPE0000', '/api/invites/a%2Fb', '/api/invites/' + 'A'.repeat(65), '/api/invites/AB']) {
    const r = await h.req('GET', p, { ip: '198.51.100.60' });
    assert.equal(r.status, 404, p);
    assert.deepEqual(r.body, { error: 'no such invite', code: 'not-found' }, p);
  }
  const ip = '198.51.100.61';
  let limited = null;
  for (let i = 0; i < 31 && !limited; i++) {
    const r = await h.req('GET', '/api/invites/RATE0000RATE0000', { ip });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'the 31st check in a minute is refused');
  assert.equal(limited.body.code, 'rate-limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await h.req('GET', '/api/invites/RATE0000RATE0000', { ip: '198.51.100.62' })).status, 200, 'another address is not');
});

test('the backup flags of a new passkey are stored, and /api/me says whether the profile is synced', async t => {
  const h = await startServer(t, { env: { INVITE_ONLY: '' } });
  const synced = softPasskey({ regFlags: FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS, authFlags: FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS });
  const local = softPasskey();

  const a = await h.signUp(synced, { name: 'Ana', ip: '198.51.100.70' });
  const b = await h.signUp(local, { name: 'Bea', ip: '198.51.100.71' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const rows = h.db().creds;
  assert.deepEqual(rows.filter(c => c.id === synced.id).map(c => [c.backupEligible, c.backedUp]), [[true, true]]);
  assert.deepEqual(rows.filter(c => c.id === local.id).map(c => [c.backupEligible, c.backedUp]), [[false, false]]);

  assert.equal((await h.req('GET', '/api/me', { cookie: a.cookie })).body.user.synced, true);
  assert.equal((await h.req('GET', '/api/me', { cookie: b.cookie })).body.user.synced, false);
  const list = await h.req('GET', '/api/account/passkeys', { cookie: a.cookie });
  assert.deepEqual(list.body.passkeys.map(p => p.synced), [true]);
});

test('a passkey from before the flags reads as unknown until its next sign-in reports them', async t => {
  const key = softPasskey({ authFlags: FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS });
  const h = await startServer(t, { users: [ADMIN, user('u1', 'Ana')], creds: [key.row('u1')], env: { INVITE_ONLY: '' } });
  assert.equal((await h.req('GET', '/api/me', { cookie: mintSession('u1') })).body.user.synced, null);

  const signedIn = await h.signIn(key, '198.51.100.80');
  assert.equal(signedIn.status, 200);
  assert.equal((await h.req('GET', '/api/me', { cookie: signedIn.cookie })).body.user.synced, true);
  assert.deepEqual(h.db().creds.map(c => [c.backupEligible, c.backedUp]), [[true, true]]);

  // A synced passkey that stopped being backed up (the keychain switched off) says so at its next use.
  key.setAuthFlags(FLAGS.UP | FLAGS.UV | FLAGS.BE);
  assert.equal((await h.signIn(key, '198.51.100.80')).status, 200);
  assert.equal((await h.req('GET', '/api/me', { cookie: signedIn.cookie })).body.user.synced, false);
});

test('a second passkey added from Settings keeps its flags too', async t => {
  const first = softPasskey();
  const second = softPasskey({ regFlags: FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS });
  const h = await startServer(t, { users: [ADMIN, user('u1', 'Ana')], creds: [first.row('u1', { backupEligible: false, backedUp: false })], env: { INVITE_ONLY: '' } });
  const ip = '198.51.100.90', cookie = mintSession('u1');
  assert.equal((await h.req('GET', '/api/me', { cookie })).body.user.synced, false);
  const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: { cid: lo.cid, credential: first.assertion(lo.options.challenge) }, cookie, ip });
  assert.equal(opt.status, 200, JSON.stringify(opt.body));
  const ver = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: opt.body.cid, credential: second.attestation(opt.body.options.challenge) }, cookie, ip });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.deepEqual(h.db().creds.find(c => c.id === second.id).backedUp, true);
  assert.equal((await h.req('GET', '/api/me', { cookie })).body.user.synced, true);
});
