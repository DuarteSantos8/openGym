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
import { boundPort, softPasskey } from './helpers.mjs';
import { startMockOidc } from './mock-oidc.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const b64u = b => Buffer.from(b).toString('base64url');
const s256 = v => crypto.createHash('sha256').update(v).digest('base64url');

async function setup(t, { env = {}, users = [], creds = [], mock: mockOpts = {} } = {}) {
  const mock = await startMockOidc(mockOpts);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oidc-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites: [] }));
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
  h.mock.next = { sub: 'good', name: 'Ana', email: 'Ana@Example.com', email_verified: true };
  const ok = await roundTrip(h);
  assert.equal((await (await h.get('/api/me', { cookie: ok.session })).json()).user.id, 'u_ana');
  assert.equal(h.db().users[0].oidc.sub, 'good');
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
  h.mock.next = { sub: 'bo-at-idp', name: 'Bo' };
  const r = await roundTrip(h, { query: link2.body.url.slice('/api/oidc/start'.length), cookie: bo });
  assert.equal(landed(r).get('oidc'), 'linked');
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
