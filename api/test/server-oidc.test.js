/* Sign in with an identity provider (#130): the real server.js in a child against a mock provider
   (mock-oidc.mjs) with its own key set. Every check gets a test that watches it refuse: a wrong
   or replayed state, a callback in another browser, a wrong nonce, an expired token, a wrong
   audience, a forged signature, an unverified e-mail, a group that is not allowed. And the good
   paths: auto-provisioning from the group, FIRST_USER_ADMIN, roles from the role map, the phone
   app's code and verifier, linking from Settings, unlinking, OIDC_ONLY, provider logout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { boundPort, softPasskey } from './helpers.mjs';
import { startMockOidc } from './mock-oidc.mjs';
import * as M from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const b64u = b => Buffer.from(b).toString('base64url');
const s256 = v => crypto.createHash('sha256').update(v).digest('base64url');

async function setup(t, { env = {}, users = [], creds = [], mock: mockOpts = {} } = {}) {
  const mock = await startMockOidc(mockOpts);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oidc-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: typeof users === 'function' ? users(mock) : users, creds, subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', AUDIT_LOG: '1', TRUST_PROXY: '1',
      INVITE_ONLY: '', ADMIN_UIDS: '', FIRST_USER_ADMIN: '', PASSWORD_LOGIN: '',
      OIDC_ISSUER: mock.issuer, OIDC_CLIENT_ID: mock.clientId, OIDC_CLIENT_SECRET: mock.clientSecret,
      OIDC_LABEL: 'VoidAuth', ...env
    }
  });
  const h = { log: '', dataDir, mock };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(async () => { child.kill('SIGKILL'); await mock.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.get = (p, { cookie, ip = '198.51.100.1' } = {}) => fetch(h.api + p, { redirect: 'manual', headers: { 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) } });
  h.post = async (p, body, { cookie, ip = '198.51.100.1', headers = {} } = {}) => {
    const r = await fetch(h.api + p, {
      method: 'POST', body: JSON.stringify(body ?? {}),
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers }
    });
    return { status: r.status, body: await r.json(), cookie: sessionOf(r) };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  return h;
}
const cookieNamed = (r, name) => r.headers.getSetCookie().find(c => c.startsWith(name + '=') && !c.startsWith(name + '=;'))?.split(';')[0] || null;
const sessionOf = r => cookieNamed(r, 'gymsid');

/* One provider round trip the way a browser makes it: start, the provider's authorize, back to
   our callback with the flow cookie. `edit(query)` may change what comes back to the callback. */
async function roundTrip(h, { query = '', cookie, ip, edit, flowCookie } = {}) {
  const start = await h.get('/api/oidc/start' + query, { cookie, ip });
  if (start.status !== 302) return { start, status: start.status, body: await start.json().catch(() => null) };
  const flow = cookieNamed(start, 'gymoidc');
  const auth = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const back = new URL(auth.headers.get('location'));
  if (edit) edit(back.searchParams);
  const jar = [flowCookie === undefined ? flow : flowCookie, cookie].filter(Boolean).join('; ');
  const cb = await h.get('/api/oidc/callback?' + back.searchParams, { cookie: jar, ip });
  const loc = cb.headers.get('location') || '';
  return { start, cb, status: cb.status, location: loc, session: sessionOf(cb), state: back.searchParams.get('state'), flow };
}
const landed = r => new URL(r.location, 'http://x').searchParams;

test('config: the provider button is public, and so is OIDC_ONLY', async t => {
  const h = await setup(t, { env: { OIDC_ONLY: '1' } });
  const cfg = await (await h.get('/api/config')).json();
  assert.deepEqual(cfg.oidc, { label: 'VoidAuth', only: true });
});

test('start: PKCE S256, a state and a nonce, and a short-lived flow cookie', async t => {
  const h = await setup(t);
  const r = await h.get('/api/oidc/start');
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.equal(u.origin + u.pathname, h.mock.issuer + '/authorize');
  const p = u.searchParams;
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('client_id'), 'opengym');
  assert.equal(p.get('redirect_uri'), ORIGIN + '/api/oidc/callback');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.match(p.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(p.get('state').length >= 40 && p.get('nonce').length >= 40);
  assert.equal(p.get('scope'), 'openid profile email');
  const c = r.headers.getSetCookie().find(x => x.startsWith('gymoidc='));
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=600/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});

test('a first sign-in from the allowed group makes the profile, FIRST_USER_ADMIN makes it admin', async t => {
  const h = await setup(t, { env: { FIRST_USER_ADMIN: '1', OIDC_ALLOWED_GROUPS: 'opengym' } });
  const r = await roundTrip(h);
  assert.equal(r.status, 302);
  assert.equal(landed(r).get('oidc'), 'signed-in');
  assert.ok(r.session, 'a session cookie is set');
  const me = await (await h.get('/api/me', { cookie: r.session })).json();
  assert.equal(me.user.name, 'Ana');
  assert.equal(me.user.admin, true);
  assert.equal(me.user.owner, true);
  assert.equal(me.user.oidc, true);
  const u = h.db().users[0];
  assert.deepEqual([u.oidc.iss, u.oidc.sub, u.oidc.email], [h.mock.issuer, 'user-1', 'ana@example.com']);
  // The PKCE verifier went to the token endpoint with the client's credentials.
  assert.ok(h.mock.seen.token[0].form.code_verifier.length >= 43);
  assert.ok(h.mock.seen.token[0].auth.startsWith('Basic '));

  // The second person is a member, not an admin, and signing in again finds the same profile.
  h.mock.next = { sub: 'user-2', name: 'Bea', groups: ['opengym'] };
  const b = await roundTrip(h, { ip: '198.51.100.2' });
  const bm = await (await h.get('/api/me', { cookie: b.session })).json();
  assert.equal(bm.user.admin, false);
  h.mock.next = { sub: 'user-1', name: 'Ana renamed', groups: ['opengym'] };
  const again = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: again.session })).json()).user.id, u.id);
  assert.equal(h.db().users.length, 2);
  assert.ok(h.audit().some(e => e.ev === 'admin.first-user'));
});

test('not in the allowed group: no profile, and a linked profile that left the group loses its sessions', async t => {
  const h = await setup(t, { env: { OIDC_ALLOWED_GROUPS: 'opengym' } });
  h.mock.next = { sub: 'stranger', name: 'Eve', groups: ['other'] };
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc-error'), 'group');
  assert.equal(r.session, null);
  assert.equal(h.db().users.length, 0);

  h.mock.next = { sub: 'user-1', name: 'Ana', groups: ['opengym'] };
  const ok = await roundTrip(h);
  assert.equal((await h.get('/api/me', { cookie: ok.session })).status, 200);
  h.mock.next = { sub: 'user-1', name: 'Ana', groups: [] };
  const out = await roundTrip(h);
  assert.equal(landed(out).get('oidc-error'), 'group');
  assert.equal((await h.get('/api/me', { cookie: ok.session })).status, 401, 'the old session ended');
  assert.ok(h.audit().some(e => e.ev === 'auth.oidc.denied' && e.msg === 'group'));
});

test('groups from userinfo count when the ID token has none (Authelia style)', async t => {
  const h = await setup(t, { env: { OIDC_ALLOWED_GROUPS: 'opengym' }, mock: { userinfoGroups: true } });
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc'), 'signed-in');
});

test('the role map: admin and access from groups, a hand-made admin is never taken away', async t => {
  const h = await setup(t, { env: { OIDC_ROLE_MAP: 'access=opengym, admin=ops' } });
  h.mock.next = { sub: 'boss', name: 'Boss', groups: ['opengym', 'ops'] };
  const r = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: r.session })).json()).user.admin, true);
  h.mock.next = { sub: 'boss', name: 'Boss', groups: ['opengym'] };
  const r2 = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: r2.session })).json()).user.admin, false, 'the claim gave it, the claim took it');
  h.mock.next = { sub: 'x', groups: ['nope'] };
  assert.equal(landed(await roundTrip(h)).get('oidc-error'), 'group', 'an access rule gates sign-up');
});

test('state: unknown, replayed, or from another browser is refused', async t => {
  const h = await setup(t);
  const wrong = await roundTrip(h, { edit: q => q.set('state', 'not-the-state') });
  assert.equal(landed(wrong).get('oidc-error'), 'state');
  assert.equal(wrong.session, null);
  // Another browser: the provider's answer pasted into a browser without the flow cookie.
  const csrf = await roundTrip(h, { flowCookie: 'gymoidc=someone-elses' });
  assert.equal(landed(csrf).get('oidc-error'), 'state');
  // Replay: the same callback a second time.
  const ok = await roundTrip(h);
  assert.ok(ok.session);
  const replay = await h.get(new URL(ok.cb.url).pathname + new URL(ok.cb.url).search, { cookie: ok.flow });
  assert.equal(new URL(replay.headers.get('location'), 'http://x').searchParams.get('oidc-error'), 'state');
  assert.equal(h.db().users.length, 1);
});

for (const [name, tamper, want] of [
  ['a wrong nonce', { claims: { nonce: 'not-ours' } }, 'nonce'],
  ['an expired token', { claims: { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 4000 } }, 'expired'],
  ['a wrong audience', { claims: { aud: 'someone-else' } }, 'audience'],
  ['another issuer', { claims: { iss: 'https://evil.example' } }, 'issuer'],
  ['a key not in the set', { rogue: true }, 'signature']
]) {
  test(`ID token: ${name} is refused`, async t => {
    const h = await setup(t);
    h.mock.tamper = tamper;
    const r = await roundTrip(h);
    assert.equal(landed(r).get('oidc-error'), 'token');
    assert.equal(r.session, null);
    assert.equal(h.db().users.length, 0);
    assert.ok(h.audit().some(e => e.ev === 'auth.oidc.fail' && e.msg === want), `audited as ${want}`);
  });
}

test('e-mail: never linked unverified, linked verified only with OIDC_EMAIL_LINKING', async t => {
  const existing = { id: 'u_ana', name: 'Ana', created: new Date().toISOString(), email: 'ana@example.com' };
  const h = await setup(t, { env: { OIDC_EMAIL_LINKING: '1' }, users: [existing] });
  h.mock.next = { sub: 'evil', name: 'Ana', email: 'ana@example.com', email_verified: false };
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc-error'), 'link-needed');
  assert.equal(r.session, null);
  assert.equal(h.db().users.length, 1);
  assert.equal(h.db().users[0].oidc, undefined);
  h.mock.next = { sub: 'evil', name: 'Ana', email: 'ana@example.com', email_verified: 'true' };
  assert.equal(landed(await roundTrip(h)).get('oidc-error'), 'link-needed', 'a string is not a verification');
  h.mock.next = { sub: 'good', name: 'Ana', email: 'Ana@Example.com', email_verified: true, picture: 'https://pics.example/ana.webp' };
  const ok = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: ok.session })).json()).user.id, 'u_ana');
  assert.equal(h.db().users[0].oidc.sub, 'good');
  assert.equal(h.db().users[0].oidc.picture, 'https://pics.example/ana.webp');
});

test('e-mail linking is off by default, even verified', async t => {
  const h = await setup(t, { users: [{ id: 'u_ana', name: 'Ana', created: new Date().toISOString(), email: 'ana@example.com' }] });
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc-error'), 'link-needed');
});

test('INVITE_ONLY without groups turns strangers away; with groups the group is the invite', async t => {
  const h = await setup(t, { env: { INVITE_ONLY: '1' } });
  assert.equal(landed(await roundTrip(h)).get('oidc-error'), 'invite');
  const g = await setup(t, { env: { INVITE_ONLY: '1', OIDC_ALLOWED_GROUPS: 'opengym' } });
  assert.equal(landed(await roundTrip(g)).get('oidc'), 'signed-in');
});

test('the provider says no (the person cancelled): back to the app, nothing made', async t => {
  const h = await setup(t);
  const r = await roundTrip(h, { edit: q => { q.delete('code'); q.set('error', 'access_denied'); } });
  assert.equal(landed(r).get('oidc-error'), 'cancelled');
});

test('phone app: exact return address, and the code is worth nothing without the verifier', async t => {
  const h = await setup(t);
  const verifier = b64u(crypto.randomBytes(40));
  const astate = b64u(crypto.randomBytes(16));
  const q = r => `?mode=app&return=${encodeURIComponent(r)}&challenge=${s256(verifier)}&astate=${astate}`;
  for (const bad of ['opengym://oidc/../x', 'https://evil.example/cb', 'opengym://oidcx', 'evil://oidc']) {
    const r = await h.get('/api/oidc/start' + q(bad));
    assert.equal(r.status, 400, bad);
    assert.equal(r.headers.get('location'), null);
  }
  const r = await roundTrip(h, { query: q('opengym://oidc') });
  assert.equal(r.status, 302);
  assert.equal(r.session, null, 'no cookie for the app');
  const back = new URL(r.location);
  assert.equal(back.protocol + '//' + back.host, 'opengym://oidc');
  assert.equal(back.searchParams.get('astate'), astate);
  const code = back.searchParams.get('code');
  const wrong = await h.post('/api/oidc/app/redeem', { code, verifier: b64u(crypto.randomBytes(40)) }, { headers: { Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'oidc-invalid');
  // The wrong try burned the code: one go, like a pairing code.
  const late = await h.post('/api/oidc/app/redeem', { code, verifier }, { headers: { Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(late.status, 400);

  const r2 = await roundTrip(h, { query: q('opengym://oidc') });
  const code2 = new URL(r2.location).searchParams.get('code');
  const ok = await h.post('/api/oidc/app/redeem', { code: code2, verifier }, { headers: { Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.cookie, null);
  const me = await fetch(h.api + '/api/me', { headers: { Authorization: 'Bearer ' + ok.body.token } });
  assert.equal((await me.json()).user.name, 'Ana');
});

test('phone app: a refusal goes back to the app with its reason and the app state', async t => {
  const h = await setup(t, { env: { OIDC_ALLOWED_GROUPS: 'opengym' } });
  h.mock.next = { sub: 'x', groups: [] };
  const verifier = b64u(crypto.randomBytes(40));
  const r = await roundTrip(h, { query: `?mode=app&return=opengym%3A%2F%2Foidc&challenge=${s256(verifier)}&astate=abcdefghijklmnop` });
  const back = new URL(r.location);
  assert.equal(back.searchParams.get('error'), 'group');
  assert.equal(back.searchParams.get('astate'), 'abcdefghijklmnop');
});

test('linking from Settings: needs the proof, a ticket for this session', async t => {
  const key = softPasskey(ORIGIN);
  const users = [{ id: 'u_bo', name: 'Bo', created: new Date().toISOString() }];
  const h = await setup(t, { users, creds: [key.row('u_bo')] });
  const opts = await h.post('/api/login/options', {});
  const login = await h.post('/api/login/verify', { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) });
  const bo = login.cookie;
  assert.ok(bo);
  assert.equal((await h.post('/api/oidc/link', {}, { cookie: bo })).status, 403, 'no proof, no ticket');
  const step = await h.post('/api/login/options', {});
  const link = await h.post('/api/oidc/link', { cid: step.body.cid, credential: key.assertion(step.body.options.challenge) }, { cookie: bo });
  assert.equal(link.status, 200);
  assert.match(link.body.url, /^\/api\/oidc\/start\?mode=link&ticket=/);
  // The ticket is no good in a browser signed in as somebody else (or nobody).
  const stolen = await h.get(link.body.url);
  assert.equal(new URL(stolen.headers.get('location'), 'http://x').searchParams.get('oidc-error'), 'link-expired');

  const step2 = await h.post('/api/login/options', {});
  const link2 = await h.post('/api/oidc/link', { cid: step2.body.cid, credential: key.assertion(step2.body.options.challenge) }, { cookie: bo });
  h.mock.next = { sub: 'bo-at-idp', name: 'Bo', picture: 'https://pics.example/bo.png' };
  const r = await roundTrip(h, { query: link2.body.url.slice('/api/oidc/start'.length), cookie: bo });
  assert.equal(landed(r).get('oidc'), 'linked');
  assert.equal(h.db().users.find(u => u.id === 'u_bo').oidc.picture, 'https://pics.example/bo.png');
  assert.match(r.location, /#\/settings\/account$/);
  assert.equal(h.db().users.find(u => u.id === 'u_bo').oidc.sub, 'bo-at-idp');
  // Signing in with the provider now finds Bo.
  const again = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: again.session })).json()).user.id, 'u_bo');

  // Unlink: Bo still has a passkey, so it may go, with the proof.
  const s3 = await h.post('/api/login/options', {});
  const un = await h.post('/api/oidc/unlink', { cid: s3.body.cid, credential: key.assertion(s3.body.options.challenge) }, { cookie: bo });
  assert.equal(un.status, 200);
  assert.equal(h.db().users.find(u => u.id === 'u_bo').oidc, undefined);
});

test('linking refuses an identity another profile already has', async t => {
  const key = softPasskey(ORIGIN);
  const h = await setup(t, { users: [{ id: 'u_bo', name: 'Bo', created: new Date().toISOString() }], creds: [key.row('u_bo')] });
  await roundTrip(h);   // Ana signs up with sub user-1
  const opts = await h.post('/api/login/options', {});
  const bo = (await h.post('/api/login/verify', { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) })).cookie;
  const step = await h.post('/api/login/options', {});
  const link = await h.post('/api/oidc/link', { cid: step.body.cid, credential: key.assertion(step.body.options.challenge) }, { cookie: bo });
  const r = await roundTrip(h, { query: link.body.url.slice('/api/oidc/start'.length), cookie: bo });
  assert.equal(landed(r).get('oidc-error'), 'taken');
  assert.equal(h.db().users.find(u => u.id === 'u_bo').oidc, undefined);
});

test('unlink: the provider is never removed when it is the last way in', async t => {
  const h = await setup(t);
  const r = await roundTrip(h);
  const un = await h.post('/api/oidc/unlink', { provider: true }, { cookie: r.session });
  assert.equal(un.status, 409);
  assert.equal(un.body.code, 'last-way-in');
});

test('provider proof: fresh after a provider sign-in, refused on a session without one', async t => {
  const key = softPasskey(ORIGIN);
  const h = await setup(t, { users: [{ id: 'u_bo', name: 'Bo', created: new Date().toISOString() }], creds: [key.row('u_bo')] });
  const opts = await h.post('/api/login/options', {});
  const pk = (await h.post('/api/login/verify', { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) })).cookie;
  const refused = await h.post('/api/pair/create', { provider: true }, { cookie: pk });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'reauth-required');
  const viaIdp = (await roundTrip(h)).session;
  const ok = await h.post('/api/pair/create', { provider: true }, { cookie: viaIdp });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.code);
});

test('reauth: only for a linked profile, and the provider has to sign in the same person', async t => {
  const h = await setup(t);
  const first = await roundTrip(h);
  const re = await roundTrip(h, { query: '?mode=reauth', cookie: first.session });
  assert.equal(landed(re).get('oidc'), 'confirmed');
  assert.equal(h.mock.seen.authorize.at(-1).prompt, 'login');
  h.mock.next = { sub: 'someone-else', name: 'Zed' };
  const other = await roundTrip(h, { query: '?mode=reauth', cookie: first.session });
  assert.equal(landed(other).get('oidc-error'), 'wrong-account');
});

test('OIDC_ONLY: no passkey sign-ups, no passkey sign-in for members, admins keep theirs', async t => {
  const member = softPasskey(ORIGIN), admin = softPasskey(ORIGIN);
  const users = [{ id: 'u_m', name: 'Mo', created: new Date().toISOString() }, { id: 'u_a', name: 'Al', created: new Date().toISOString(), admin: true, owner: true }];
  const h = await setup(t, { env: { OIDC_ONLY: '1' }, users, creds: [member.row('u_m'), admin.row('u_a')] });
  const reg = await h.post('/api/register/options', { name: 'New' });
  assert.equal(reg.status, 403);
  assert.equal(reg.body.code, 'oidc-only');
  const o1 = await h.post('/api/login/options', {});
  const m = await h.post('/api/login/verify', { cid: o1.body.cid, credential: member.assertion(o1.body.options.challenge) });
  assert.equal(m.status, 403);
  assert.equal(m.body.code, 'oidc-only');
  assert.equal(m.cookie, null);
  const o2 = await h.post('/api/login/options', {});
  const a = await h.post('/api/login/verify', { cid: o2.body.cid, credential: admin.assertion(o2.body.options.challenge) });
  assert.equal(a.status, 200);
  assert.ok(a.cookie);
});

test('logout: the provider logout address only with OIDC_LOGOUT, and admin status', async t => {
  const h = await setup(t, { env: { OIDC_LOGOUT: '1', FIRST_USER_ADMIN: '1' } });
  const r = await roundTrip(h);
  const st = await (await h.get('/api/admin/oidc', { cookie: r.session })).json();
  assert.equal(st.enabled, true);
  assert.equal(st.reachable, true);
  assert.equal(st.keys, 1);
  assert.equal(st.linked, 1);
  assert.equal(st.logout, true);
  assert.equal('clientSecret' in st, false, 'the secret never leaves');
  assert.equal(JSON.stringify(st).includes('s3cret'), false);
  const out = await h.post('/api/logout', {}, { cookie: r.session });
  const u = new URL(out.body.provider_logout);
  assert.equal(u.origin + u.pathname, h.mock.issuer + '/logout');
  assert.equal(u.searchParams.get('post_logout_redirect_uri'), ORIGIN + '/');
  const plain = await setup(t);
  const p = await roundTrip(plain);
  assert.equal((await plain.post('/api/logout', {}, { cookie: p.session })).body.provider_logout, undefined);
});

test('the callback is rate-limited per address', async t => {
  const h = await setup(t);
  let last;
  for (let i = 0; i < 32; i++) last = await h.get('/api/oidc/callback?state=x&code=y', { ip: '203.0.113.9' });
  assert.equal(new URL(last.headers.get('location'), 'http://x').searchParams.get('oidc-error'), 'throttled');
  // Another address is not paused.
  const other = await h.get('/api/oidc/callback?state=x&code=y', { ip: '203.0.113.10' });
  assert.equal(new URL(other.headers.get('location'), 'http://x').searchParams.get('oidc-error'), 'state');
});

test('without OIDC_* nothing changes: every route is a 404 and /api/config has no oidc', async t => {
  const h = await setup(t, { env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' } });
  assert.equal((await h.get('/api/oidc/start')).status, 404);
  assert.equal((await h.get('/api/oidc/callback')).status, 404);
  assert.equal('oidc' in await (await h.get('/api/config')).json(), false);
});

const meOf = async (h, session) => (await (await h.get('/api/me', { cookie: session })).json()).user;
const picture = (h, session, headers = {}) => fetch(h.api + '/api/oidc/picture', {
  headers: Object.fromEntries(Object.entries({ 'Sec-Fetch-Site': 'same-origin', ...(session ? { Cookie: session } : {}), ...headers }).filter(([, v]) => v != null))
});

test('the picture claim: kept at every provider sign-in, read from userinfo too, forgotten by a sign-in without one', async t => {
  const h = await setup(t);
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.png' };
  const first = await roundTrip(h);
  const one = await meOf(h, first.session);
  assert.match(one.oidcPicture, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.equal(h.db().users[0].oidc.picture, h.mock.issuer + '/ana.png');
  assert.equal(h.db().users[0].oidc.pictureAt, one.oidcPicture);

  await new Promise(r => setTimeout(r, 5));
  const two = await meOf(h, (await roundTrip(h)).session);
  assert.ok(two.oidcPicture > one.oidcPicture, 'the next sign-in names the picture again with its own time');

  // Only in userinfo, as Authelia sends it.
  const { picture: _, ...plain } = h.mock.next;
  h.mock.next = plain;
  h.mock.tamper = { userinfo: { picture: h.mock.issuer + '/from-userinfo.png' } };
  await roundTrip(h);
  assert.equal(h.db().users[0].oidc.picture, h.mock.issuer + '/from-userinfo.png');

  h.mock.tamper = {};
  const last = h.db().users[0].oidc.pictureAt;
  const none = await meOf(h, (await roundTrip(h)).session);
  assert.equal('oidcPicture' in none, false);
  assert.equal('picture' in h.db().users[0].oidc, false);
  assert.equal(h.db().users[0].oidc.pictureAt, last, 'the time stays, so the next sign-in with one comes after it');

  for (const bad of ['javascript:alert(1)', 'ftp://pics.example/a.png', 'https://u:p@pics.example/a.png', 'https://pics.example/' + 'a'.repeat(2100), 42, '']) {
    h.mock.next = { ...plain, picture: bad };
    await roundTrip(h);
    assert.equal('picture' in h.db().users[0].oidc, false, String(bad).slice(0, 30));
  }
});

test('the picture claim is not kept, and not fetched, where uploads are off', async t => {
  const h = await setup(t, { env: { MEDIA_UPLOADS: '0' } });
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.png' };
  const r = await roundTrip(h);
  assert.equal('oidcPicture' in await meOf(h, r.session), false);
  assert.equal('picture' in h.db().users[0].oidc, false);
  assert.equal((await picture(h, r.session)).status, 404);
});

test('GET /api/oidc/picture: the signed-in profile\'s own picture, relayed as an image and never cached', async t => {
  const h = await setup(t);
  const pic = M.png(3000);
  h.mock.files['/ana.png'] = { body: pic, type: 'image/png' };
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.png' };
  const ana = (await roundTrip(h)).session;
  const anaId = h.db().users[0].id;

  assert.equal((await picture(h, null)).status, 401);
  const r = await picture(h, ana);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(pic));
  assert.equal((await picture(h, ana, { 'X-OpenGym-Account': anaId })).status, 200);

  h.mock.next = { sub: 'user-2', name: 'Bea', groups: ['opengym'] };
  const bea = (await roundTrip(h, { ip: '198.51.100.2' })).session;
  const none = await picture(h, bea);
  assert.equal(none.status, 404, 'a provider that names no picture gives none, not another profile\'s');
  assert.equal((await none.json()).code, 'no-picture');
  const other = await picture(h, ana, { 'X-OpenGym-Account': 'someone-else' });
  assert.equal(other.status, 409, 'a session used for an account the device no longer means');
  assert.equal((await other.json()).code, 'account-mismatch');
  assert.deepEqual(h.mock.seen.files, ['/ana.png', '/ana.png'], 'the provider was asked for Ana\'s picture only');
});

test('GET /api/oidc/picture refuses what is too large, not an image, or not to be had', async t => {
  const h = await setup(t, { env: { MEDIA_IMAGE_MAX_MB: '0.002' } });
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/p' };
  const s = (await roundTrip(h)).session;
  const answer = async file => {
    h.mock.files['/p'] = file;
    const r = await picture(h, s);
    return [r.status, (await r.json()).code];
  };
  assert.deepEqual(await answer({ body: M.png(5000) }), [413, 'media-too-large']);
  assert.deepEqual(await answer({ body: M.png(5000), chunked: true }), [413, 'media-too-large']);
  assert.deepEqual(await answer({ body: M.svg(), type: 'image/svg+xml' }), [415, 'media-type']);
  assert.deepEqual(await answer({ body: M.html(), type: 'image/png' }), [415, 'media-type']);
  assert.deepEqual(await answer({ body: M.mp4({ mdatBytes: 200 }), type: 'image/png' }), [415, 'media-type']);
  assert.deepEqual(await answer({ body: Buffer.alloc(0) }), [415, 'media-type']);
  assert.deepEqual(await answer({ status: 500, body: M.png(100) }), [502, 'picture-unavailable']);
  assert.deepEqual(await answer({ status: 302, body: Buffer.alloc(0), headers: { Location: h.mock.issuer + '/elsewhere.png' } }), [422, 'picture-refused']);
  assert.deepEqual(await answer({ status: 404, body: Buffer.alloc(0) }), [422, 'picture-refused']);
  const why = h.audit().filter(e => e.ev === 'auth.oidc.picture').map(e => e.msg);
  assert.deepEqual(why, ['the picture is too large', 'the picture is too large', 'not a JPEG, PNG, WebP or GIF', 'not a JPEG, PNG, WebP or GIF',
    'not a JPEG, PNG, WebP or GIF', 'not a JPEG, PNG, WebP or GIF', 'HTTP 500', 'HTTP 302', 'HTTP 404']);
  assert.equal(JSON.stringify(h.audit()).includes(h.mock.issuer + '/p'), false, 'the audit log says why, never where');
});

test('PUT /api/data keeps the provider-picture mark when a write lacks it, carries an older one, or names another picture of the same sign-in', async t => {
  const h = await setup(t);
  const s = (await roundTrip(h)).session;
  let told = 0;
  const put = async state => { const r = await fetch(h.api + '/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: s }, body: JSON.stringify({ state: { workouts: [], routines: [], ...state } }) }); told = (await r.clone().json()).rev; return r.status; };
  const stored = async () => (await (await h.get('/api/data', { cookie: s })).json()).rev;
  const mark = async () => (await (await h.get('/api/data', { cookie: s })).json()).state.avatarOidc;
  const T = d => `2026-10-${d}T09:00:00.000Z`;
  const pic = c => ({ m: { kind: 'image', hash: c.repeat(64), mime: 'image/webp', size: 9000, width: 256, height: 256, at: 1 } });
  const junk = { at: '2' + 'z'.repeat(100) };
  assert.equal(await put({ _ts: 50, avatarOidc: junk }), 200);
  assert.equal(await mark(), undefined, 'a mark that is no time is not stored');
  assert.equal(await put({ _ts: 100, avatarOidc: { at: T(27) } }), 200);
  assert.deepEqual(await mark(), { at: T(27) }, 'a mark that is no time holds no sign-in back');
  assert.equal(await stored(), told, 'stored as sent');
  assert.equal(await put({ _ts: 200 }), 200);
  assert.deepEqual(await mark(), { at: T(27) }, 'a backup from before it');
  assert.equal(await stored(), told + 1, 'one further than the writer was told, so it reads it again');
  assert.equal(await put({ _ts: 300, avatarOidc: { at: T(20), hash: 'a'.repeat(64) } }), 200);
  assert.deepEqual(await mark(), { at: T(27) }, 'an older sign-in');
  assert.equal(await put({ _ts: 400, avatar: pic('b'), avatarOidc: { at: T(28), hash: 'b'.repeat(64) } }), 200);
  assert.equal(await put({ _ts: 500, avatar: pic('b'), avatarOidc: { at: T(28), hash: 'a'.repeat(64) } }), 200);
  assert.deepEqual(await mark(), { at: T(28), hash: 'b'.repeat(64) }, 'the same sign-in, naming a picture not shown');
  assert.equal(await put({ _ts: 550, avatar: pic('a'), avatarOidc: { at: T(28), hash: 'a'.repeat(64) } }), 200);
  assert.deepEqual(await mark(), { at: T(28), hash: 'a'.repeat(64) }, 'the same sign-in, naming the picture shown');
  assert.equal(await put({ _ts: 600, avatarOidc: { at: T(29) } }), 200);
  assert.deepEqual(await mark(), { at: T(29) });
  assert.equal(await put((await (await h.get('/api/data', { cookie: s })).json()).state), 200);
  assert.equal(await stored(), told, 'what is stored, sent back, changes nothing');
  let deep = {};
  for (let i = 0, o = deep; i < 20000; i++) o = o.x = {};
  const odd = [junk, { at: 'x' }, { at: '2026-10-30T09:00:00Z' }, { at: '2026-10-30 09:00:00.000Z' }, { at: '9999-99-99T99:99:99.999Z' }, { at: '9999-12-31T23:59:59.999Z' }, deep];
  for (const [i, j] of odd.entries()) {
    assert.equal(await put({ _ts: 700 + i, avatarOidc: j }), 200);
    assert.deepEqual(await mark(), { at: T(29) }, 'no time is no later sign-in');
  }
  assert.equal(await put({ _ts: 800, avatar: pic('a'), avatarOidc: { at: T(20), hash: 'a'.repeat(64) } }), 200);
  assert.deepEqual(await mark(), { at: T(29), hash: 'a'.repeat(64) }, 'a backup\'s provider picture stays the provider\'s');
  assert.equal(await put({ _ts: 900, avatar: pic('c'), avatarOidc: { at: T(21), hash: 'd'.repeat(64) } }), 200);
  assert.deepEqual(await mark(), { at: T(29), hash: 'a'.repeat(64) }, 'and its own photo its own');
  assert.equal(await put({ _ts: 1000, avatarOidc: { at: T(30), hash: 'z'.repeat(900), note: 'x' } }), 200);
  assert.deepEqual(await mark(), { at: T(30) }, 'only the time and a picture hash are kept');
  for (const [i, hash] of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), ' ' + 'a'.repeat(64)].entries()) {
    const at = `2026-11-1${i}T09:00:00.000Z`;
    assert.equal(await put({ _ts: 1100 + i, avatarOidc: { at, hash } }), 200);
    assert.deepEqual(await mark(), { at }, 'no picture hash is no picture');
  }
  const echo = (await (await h.get('/api/data', { cookie: s })).json()).state;
  echo.avatarOidc = { ...echo.avatarOidc, note: 'x' };
  assert.equal(await put(echo), 200);
  assert.deepEqual(await mark(), { at: '2026-11-13T09:00:00.000Z' });
  assert.equal(await stored(), told + 1, 'a key dropped from the mark is a change the writer reads');
  const ahead = days => new Date(Date.now() + days * 864e5).toISOString();
  assert.equal(await put({ _ts: 1200, avatarOidc: { at: ahead(2) } }), 200);
  assert.deepEqual(await mark(), { at: '2026-11-13T09:00:00.000Z' }, 'two days ahead of the clock and of the last sign-in');
  const soon = ahead(1 / 24);
  assert.equal(await put({ _ts: 1300, avatarOidc: { at: soon } }), 200);
  assert.deepEqual(await mark(), { at: soon }, 'an hour ahead');
});

test('PUT /api/data takes the mark of the account\'s last provider sign-in even ahead of the clock, and no later time', async t => {
  const ana = softPasskey(ORIGIN);
  const ahead = days => new Date(Date.now() + days * 864e5).toISOString();
  const at = new Date().toISOString(), signedIn = ahead(3);
  const users = [{ id: 'u_ana', name: 'Ana', created: at, oidc: { iss: 'https://idp.example', sub: 'ana', linked: at, picture: 'https://idp.example/ana.png', pictureAt: signedIn } }];
  const h = await setup(t, { users, creds: [ana.row('u_ana')] });
  const o = await h.post('/api/login/options', {});
  const s = (await h.post('/api/login/verify', { cid: o.body.cid, credential: ana.assertion(o.body.options.challenge) })).cookie;
  let told = 0;
  const put = async (state, stamped = false) => { const r = await fetch(h.api + '/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: s }, body: JSON.stringify({ state: { workouts: [], routines: [], ...state }, stamped }) }); told = (await r.clone().json()).rev; return r.status; };
  const data = async () => (await (await h.get('/api/data', { cookie: s })).json());
  assert.equal(await put({ _ts: 100, avatarOidc: { at: ahead(4) } }), 200);
  assert.equal((await data()).state.avatarOidc, undefined, 'after the last sign-in and days ahead');
  assert.equal(await put({ _ts: 300, avatarOidc: { at: signedIn } }), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: signedIn });
  assert.equal((await data()).rev, told, 'stored as sent, so the device does not fetch it again');
  assert.equal(await put({ _ts: 400, avatarOidc: { at: ahead(4) } }), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: signedIn }, 'a later time than the sign-in');
  assert.equal(await put({ _ts: 500 }), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: signedIn }, 'a write without it');
  assert.equal(await put({ _ts: 600, avatarOidc: { at } }, true), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: signedIn }, 'an older mark from an app that stamps');
  assert.equal(await put({ _ts: 700 }, true), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: signedIn }, 'a write without it from an app that stamps');
  const proof = await h.post('/api/login/options', {});
  assert.equal((await h.post('/api/oidc/unlink', { cid: proof.body.cid, credential: ana.assertion(proof.body.options.challenge) }, { cookie: s })).status, 200);
  assert.equal(await put({ _ts: 800, avatarOidc: { at } }, true), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at }, 'unlinked, the time days ahead is no sign-in any more');
});

test('a sign-in after the server clock was set back still comes after the last one, and a device\'s mark of the last one stays', async t => {
  const at = new Date().toISOString(), ahead = new Date(Date.now() + 3 * 864e5).toISOString();
  const h = await setup(t, { users: mock => [{ id: 'u_ana', name: 'Ana', created: at, oidc: { iss: mock.issuer, sub: 'user-1', linked: at, picture: mock.issuer + '/a.png', pictureAt: ahead } }] });
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/b.png' };
  const s = (await roundTrip(h)).session;
  const first = (await meOf(h, s)).oidcPicture;
  assert.ok(first > ahead, first);
  let told = 0;
  const put = async state => { const r = await fetch(h.api + '/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: s }, body: JSON.stringify({ state: { workouts: [], routines: [], ...state } }) }); told = (await r.clone().json()).rev; return r.status; };
  const data = async () => (await (await h.get('/api/data', { cookie: s })).json());
  const pic = { m: { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 9000, width: 256, height: 256, at: 1 } };
  assert.equal(await put({ _ts: 100, avatar: pic, avatarOidc: { at: ahead, hash: 'a'.repeat(64) } }), 200);
  assert.deepEqual((await data()).state.avatarOidc, { at: ahead, hash: 'a'.repeat(64) }, 'the provider picture of the sign-in before stays the provider\'s');
  assert.equal((await data()).rev, told);
  const second = (await meOf(h, (await roundTrip(h)).session)).oidcPicture;
  assert.ok(second > first, second);
  const { picture: _, ...plain } = h.mock.next;
  h.mock.next = plain;
  await roundTrip(h);
  h.mock.next = { ...plain, picture: h.mock.issuer + '/c.png' };
  assert.ok((await meOf(h, (await roundTrip(h)).session)).oidcPicture > second, 'a sign-in without a picture in between');
});

test('confirming it is you at the provider leaves the picture as the last sign-in left it', async t => {
  const h = await setup(t);
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.png' };
  const first = await roundTrip(h);
  const before = { ...h.db().users[0].oidc };
  await new Promise(r => setTimeout(r, 5));
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/new.png' };
  const re = await roundTrip(h, { query: '?mode=reauth', cookie: first.session });
  assert.equal(landed(re).get('oidc'), 'confirmed');
  assert.equal(h.db().users[0].oidc.picture, before.picture);
  assert.equal(h.db().users[0].oidc.pictureAt, before.pictureAt);
  const { picture: _, ...plain } = h.mock.next;
  h.mock.next = plain;
  h.mock.files['/userinfo'] = { type: 'application/json', body: Buffer.from(JSON.stringify({ sub: 'user-1', picture: h.mock.issuer + '/ui.png' })) };
  assert.equal(landed(await roundTrip(h, { query: '?mode=reauth', cookie: first.session })).get('oidc'), 'confirmed');
  assert.deepEqual(h.mock.seen.files, [], 'nor is userinfo asked for one');
  assert.equal(h.db().users[0].oidc.pictureAt, before.pictureAt);
});

test('GET /api/oidc/picture fetches off the issuer\'s own origin only from public addresses', async t => {
  const h = await setup(t);
  let asked = 0;
  const inside = http.createServer((req, res) => { asked++; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(M.png(100)); });
  await new Promise(r => inside.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => inside.close(r)));
  const port = inside.address().port;
  for (const url of [`http://127.0.0.1:${port}/p.png`, `http://localhost:${port}/p.png`, `http://[::1]:${port}/p.png`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/p.png`]) {
    h.mock.next = { sub: 'user-1', name: 'Ana', groups: ['opengym'], picture: url };
    const s = (await roundTrip(h)).session;
    const r = await picture(h, s);
    assert.equal(r.status, 422, url);
    assert.equal((await r.json()).code, 'picture-refused');
  }
  assert.equal(asked, 0, 'nothing on a private address was ever asked');
});

test('a picture named by a provider this server no longer uses is neither announced nor fetched', async t => {
  const ana = softPasskey(ORIGIN);
  const at = new Date().toISOString();
  const users = [{ id: 'u_ana', name: 'Ana', created: at, oidc: { iss: 'https://old-idp.example', sub: 'ana', linked: at, picture: 'https://old-idp.example/ana.png', pictureAt: at } }];
  const h = await setup(t, { users, creds: [ana.row('u_ana')] });
  const o = await h.post('/api/login/options', {});
  const s = (await h.post('/api/login/verify', { cid: o.body.cid, credential: ana.assertion(o.body.options.challenge) })).cookie;
  assert.ok(s);
  assert.equal('oidcPicture' in await meOf(h, s), false);
  const r = await picture(h, s);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'no-picture');
});

test('a userinfo asked only for the picture brings nothing else, so its email_verified links no one', async t => {
  const existing = { id: 'u_ana', name: 'Ana', created: new Date().toISOString(), email: 'ana@example.com' };
  const h = await setup(t, { env: { OIDC_EMAIL_LINKING: '1' }, users: [existing] });
  h.mock.next = { sub: 'evil', name: 'Ana', email: 'ana@example.com', groups: ['opengym'] };
  h.mock.tamper = { userinfo: { email_verified: true, picture: h.mock.issuer + '/ana.png' } };
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc-error'), 'link-needed');
  assert.equal(r.session, null);
  assert.equal(h.db().users[0].oidc, undefined);
});

test('a userinfo asked only for the picture that fails is no provider error on the admin page', async t => {
  const h = await setup(t, { env: { FIRST_USER_ADMIN: '1' } });
  h.mock.files['/userinfo'] = { status: 500, type: 'application/json', body: Buffer.from('{"error":"boom"}') };
  const r = await roundTrip(h);
  assert.equal(landed(r).get('oidc'), 'signed-in');
  assert.deepEqual(h.mock.seen.files, ['/userinfo']);
  const st = await (await h.get('/api/admin/oidc', { cookie: r.session })).json();
  assert.equal(st.lastError, null);
});

test('GET /api/oidc/picture: another site can neither fetch it nor spend the hourly budget, which all sessions share', async t => {
  const h = await setup(t);
  h.mock.files['/ana.png'] = { body: M.png(300), type: 'image/png' };
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.png' };
  const one = (await roundTrip(h)).session;
  for (const site of ['cross-site', 'same-site']) {
    const r = await picture(h, one, { 'Sec-Fetch-Site': site, 'Sec-Fetch-Mode': 'navigate' });
    assert.equal(r.status, 403, site);
    assert.equal((await r.json()).code, 'origin-mismatch');
  }
  // Safari before 16.4 sends neither Sec-Fetch-Site nor, on a GET, an Origin: the app's own header decides.
  assert.equal((await picture(h, one, { 'Sec-Fetch-Site': null })).status, 403);
  assert.deepEqual(h.mock.seen.files, []);
  const uid = h.db().users[0].id;
  const two = (await roundTrip(h)).session;
  for (let i = 0; i < 10; i++) {
    const r = await picture(h, i % 2 ? one : two, i % 2 ? {} : { 'Sec-Fetch-Site': null, 'X-OpenGym-Account': uid });
    assert.equal(r.status, 200, `fetch ${i + 1}`);
  }
  const over = await picture(h, two);
  assert.equal(over.status, 429);
  assert.equal((await over.json()).code, 'locked');
  assert.ok(Number(over.headers.get('retry-after')) > 0);
  assert.equal(h.mock.seen.files.length, 10);
});

test('the phone app\'s sign-in brings the picture too, and its token fetches it', async t => {
  const h = await setup(t);
  h.mock.files['/ana.webp'] = { body: M.webp(2000), type: 'image/webp' };
  h.mock.next = { ...h.mock.next, picture: h.mock.issuer + '/ana.webp' };
  const verifier = b64u(crypto.randomBytes(40));
  const q = `?mode=app&return=${encodeURIComponent('opengym://oidc')}&challenge=${s256(verifier)}&astate=${b64u(crypto.randomBytes(16))}`;
  const r = await roundTrip(h, { query: q });
  const code = new URL(r.location).searchParams.get('code');
  const ok = await h.post('/api/oidc/app/redeem', { code, verifier }, { headers: { Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(ok.status, 200);
  assert.match(ok.body.user.oidcPicture, /T/);
  const pic = await fetch(h.api + '/api/oidc/picture', { headers: { Authorization: 'Bearer ' + ok.body.token, Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/webp');
});
