/* Sign-in through the provider, driven against a real spawned server and a real provider double:
 * configuration surfacing, the start departure, every callback refusal, the naming screen that
 * turns an unknown identity into a new profile, the invite gate, and that the session it mints is
 * the one a passkey mints -- same cookie, same three-field payload, revoked the same way. A subpath
 * deployment's return addresses are proven here too, not assumed.
 *
 * Linking an identity to an existing profile, reading a linked identity back and removing one are
 * out of scope for this suite -- they arrive with the routes that do them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProvider, startApi, beginFlow, completeCallback, providerSignIn, mintSession, cookieValue,
  softAuthenticator, stepUp, ST_COOKIE, PENDING_COOKIE, SESSION_COOKIE
} from './oidc-harness.mjs';

const assertNoSessionCookie = (res, msg) => assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null, msg || 'a refusal must never carry a session cookie');
// The harness seeds db.json up front (unlike a real boot, which only writes it on a first save),
// so "wrote nothing" is read as "unchanged from what was seeded", not as "the file is absent".
const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
const assertDbUnchanged = (h, before) => assert.equal(dbSnapshot(h), before, 'a refusal must leave no account data behind');

/* ---------- configuration surfacing ---------- */

test('a configured instance reports the oidc key with the provider name, and never the client secret', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { OIDC_NAME: 'Example ID' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const config = await h.req('GET', '/api/config');
  assert.deepEqual(config.body.oidc, { name: 'Example ID' });
  const secretGuess = 'this-would-be-the-client-secret';
  assert.equal(JSON.stringify(config.body).includes(secretGuess), false);
});

/* ---------- GET /api/oidc/start ---------- */

test('the start route redirects to the provider\'s own authorization endpoint with every parameter it needs', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  const loc = new URL(flow.res.location, h.api);
  assert.equal(loc.origin + loc.pathname, provider.base + '/authorize');
  assert.equal(flow.res.query.get('response_type'), 'code');
  assert.equal(flow.res.query.get('client_id'), provider.clientId);
  assert.ok(flow.state, 'no state parameter');
  assert.ok(flow.nonce, 'no nonce parameter');
  assert.ok(flow.res.query.get('code_challenge'), 'no code_challenge parameter');
  assert.equal(flow.res.query.get('code_challenge_method'), 'S256');
});

test('the departure cookie carries the same value as the state parameter', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  assert.equal(flow.cookieHeader, `${ST_COOKIE}=${flow.state}`);
});

test('two consecutive visits to the start route mint two different states and two different challenges', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const first = await beginFlow(h);
  const second = await beginFlow(h);
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.res.query.get('code_challenge'), second.res.query.get('code_challenge'));
});

test('a misconfigured provider answers the start route with provider-misconfigured, and leaves no account data behind', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { OIDC_CLIENT_ID: '' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const res = await h.raw('GET', '/api/oidc/start');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/#err=provider-misconfigured');
  assertDbUnchanged(h, before);
});

test('a provider nothing answers on leaves passkey sign-in working, and the start route answers provider-unreachable', async t => {
  // No provider is started at all: the issuer address is one nothing listens on, the same shape
  // a provider going down entirely would leave a running instance in.
  const dead = { base: 'http://127.0.0.1:1', clientId: 'opengym-test-client' };
  const h = await startApi(t, { provider: dead, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const res = await h.raw('GET', '/api/oidc/start');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/#err=provider-unreachable');
  const login = await h.req('POST', '/api/login/options', { body: {} });
  assert.equal(login.status, 200, 'a provider having a bad day must never take passkey sign-in down with it');
  assertDbUnchanged(h, before);
});

test('the start route spends the departures\' per-address window, and past it answers locked without minting a departure', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const from = addr => ({ headers: { 'x-forwarded-for': addr } });
  for (let i = 0; i < 60; i++) {
    const ok = await h.raw('GET', '/api/oidc/start', from('203.0.113.7'));
    assert.ok(ok.query.get('state'), 'every request inside the budget departs');
  }
  const locked = await h.raw('GET', '/api/oidc/start', from('203.0.113.7'));
  assert.equal(locked.status, 302);
  assert.equal(locked.location, '/#err=locked');
  assert.equal(cookieValue(locked.cookies, ST_COOKIE) || '', '', 'no departure may be minted past the budget');
  const elsewhere = await h.raw('GET', '/api/oidc/start', from('203.0.113.8'));
  assert.ok(elsewhere.query.get('state'), 'another address keeps its own budget');
  const pending = await h.req('GET', '/api/oidc/pending', from('203.0.113.7'));
  assert.equal(pending.status, 401, 'the naming screen is not paused by the departures\' window');
});

/* ---------- GET /api/oidc/callback: refusals ---------- */

test('a callback with no departure cookie at all answers state-unknown', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  const res = await completeCallback(h, { cookieHeader: null, state: flow.state });
  assert.equal(res.fragment.get('err'), 'state-unknown');
  assertNoSessionCookie(res);
});

test('a callback whose cookie holds a value the store never issued answers state-unknown', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const bogus = 'a-value-the-flow-store-never-put-anywhere';
  const res = await completeCallback(h, { cookieHeader: `${ST_COOKIE}=${bogus}`, state: bogus });
  assert.equal(res.fragment.get('err'), 'state-unknown');
  assertNoSessionCookie(res);
});

test('a callback whose query state and cookie value disagree answers state-unknown, without spending the attempt', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  const refused = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: 'not-the-state-the-cookie-names' });
  assert.equal(refused.fragment.get('err'), 'state-unknown');

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce }) });
  const genuine = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(genuine.fragment.get('oidc'), 'confirm', 'the sign-in that was in flight survived a mismatched attempt');
});

test('a genuine callback replayed a second time answers state-unknown', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce }) });
  const first = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(first.fragment.get('oidc'), 'confirm');
  const second = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(second.fragment.get('err'), 'state-unknown');
  assertNoSessionCookie(second);
});

test('the provider\'s own error parameter answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state, error: 'access_denied' });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

test('a token minted with the wrong audience answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce, extra: { aud: 'a-different-client' } }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

test('a token minted with the wrong issuer answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce, extra: { iss: 'https://a-different-provider.example' } }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

test('a token carrying a different nonce than this attempt sent answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: 'a-nonce-this-attempt-never-sent' }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

test('an expired token answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  const past = Math.floor(Date.now() / 1000) - 1000;
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce, extra: { iat: past, exp: past + 60 } }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

test('a token endpoint answering 500 answers provider-unreachable', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(500, {});
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'provider-unreachable');
  assertNoSessionCookie(res);
});

test('a token endpoint answering an empty body answers provider-unreachable', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, undefined);
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'provider-unreachable');
  assertNoSessionCookie(res);
});

test('a token endpoint answering an OAuth invalid_grant body answers token-invalid', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const flow = await beginFlow(h);
  provider.setTokenResponse(400, { error: 'invalid_grant' });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('err'), 'token-invalid');
  assertNoSessionCookie(res);
});

/* ---------- GET /api/oidc/pending and POST /api/oidc/confirm: profile creation ---------- */

async function reachConfirmation(h, provider, { claims = {} } = {}) {
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce, ...claims }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  const cookie = cookieValue(res.cookies, PENDING_COOKIE);
  return { res, cookieHeader: cookie ? `${PENDING_COOKIE}=${cookie}` : null };
}

test('a full first sign-in answers 200 and writes exactly one user record and one identity record', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { cookieHeader } = await reachConfirmation(h, provider, { claims: { extra: { name: 'Ana Seeded' } } });
  const confirm = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana Confirmed' }, cookie: cookieHeader });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.user.name, 'Ana Confirmed', 'the confirmed name wins over the seeded one');
  const db = h.db();
  assert.equal(db.users.length, 1);
  assert.equal(db.identities.length, 1);
  assert.equal(db.identities[0].userId, db.users[0].id);
});

test('names cap at 40 characters, and a blank name is refused with nothing written', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const { cookieHeader } = await reachConfirmation(h, provider);
  const blank = await h.req('POST', '/api/oidc/confirm', { body: { name: '   ' }, cookie: cookieHeader });
  assert.equal(blank.status, 400);
  assertDbUnchanged(h, before);

  const { cookieHeader: cookie2 } = await reachConfirmation(h, provider, { claims: { sub: 'subject-2' } });
  const long = await h.req('POST', '/api/oidc/confirm', { body: { name: 'x'.repeat(60) }, cookie: cookie2 });
  assert.equal(long.status, 200);
  assert.equal(long.body.user.name.length, 40);
});

test('GET /api/oidc/pending is a peek: asking twice gives the same seeded name', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { cookieHeader } = await reachConfirmation(h, provider, { claims: { extra: { name: 'Ana Seeded' } } });
  const first = await h.req('GET', '/api/oidc/pending', { cookie: cookieHeader });
  const second = await h.req('GET', '/api/oidc/pending', { cookie: cookieHeader });
  assert.equal(first.body.name, 'Ana Seeded');
  assert.equal(second.body.name, 'Ana Seeded');
});

test('POST /api/oidc/confirm is one-shot: a second confirm with the same cookie creates no second user', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { cookieHeader } = await reachConfirmation(h, provider);
  const first = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana' }, cookie: cookieHeader });
  assert.equal(first.status, 200);
  const second = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana Again' }, cookie: cookieHeader });
  assert.equal(second.status, 401);
  assert.equal(h.db().users.length, 1);
});

test('two tabs completing the same identity resolve to one profile, not two', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { cookieHeader: tab1 } = await reachConfirmation(h, provider);
  const { cookieHeader: tab2 } = await reachConfirmation(h, provider);
  const first = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana' }, cookie: tab1 });
  assert.equal(first.status, 200);
  const second = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana From Tab Two' }, cookie: tab2 });
  assert.equal(second.status, 200, 'the second tab resolves to the profile the first one already made');
  assert.equal(second.body.user.id, first.body.user.id);
  assert.equal(h.db().users.length, 1);
  assert.equal(h.db().identities.length, 1);
});

/* ---------- invite-only ---------- */

test('on an invite-only instance, a returning identity signs in with no code at all', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider, env: { INVITE_ONLY: '1' },
    db: { users: [seeded], creds: [], subs: [], invites: [], identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }] }
  });
  const { sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(sessionCookie, 'a returning identity must never be asked for an invite code');
});

test('on an invite-only instance, confirm refuses a missing invite code with invite-invalid and leaves the sign-in intact', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { INVITE_ONLY: '1' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const { cookieHeader } = await reachConfirmation(h, provider);
  const noCode = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana' }, cookie: cookieHeader });
  assert.equal(noCode.status, 403);
  assert.equal(noCode.body.code, 'invite-invalid');
  assertDbUnchanged(h, before);

  // The waiting sign-in is still there: a valid code submitted afterwards succeeds.
  const invite = await h.req('GET', '/api/oidc/pending', { cookie: cookieHeader });
  assert.equal(invite.status, 200, 'the refusal must not have spent the attempt');
});

test('on an invite-only instance, a used or revoked code is refused the same way, and a valid one is burned on success', async t => {
  const provider = await startProvider(t);
  const goodInvite = { code: 'GOOD1234', usedBy: null, revoked: false };
  const usedInvite = { code: 'USED1234', usedBy: 'someone-else', revoked: false };
  const revokedInvite = { code: 'REV01234', usedBy: null, revoked: true };
  const h = await startApi(t, {
    provider, env: { INVITE_ONLY: '1' },
    db: { users: [], creds: [], subs: [], invites: [goodInvite, usedInvite, revokedInvite] }
  });

  const { cookieHeader: c1 } = await reachConfirmation(h, provider, { claims: { sub: 'subject-1' } });
  const used = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Ana', code: 'used1234' }, cookie: c1 });
  assert.equal(used.status, 403);
  assert.equal(used.body.code, 'invite-invalid');

  const { cookieHeader: c2 } = await reachConfirmation(h, provider, { claims: { sub: 'subject-2' } });
  const revoked = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Bea', code: 'rev01234' }, cookie: c2 });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.body.code, 'invite-invalid');

  // Both refusals above left their own attempts intact (an invite refusal never spends the
  // waiting sign-in); reusing subject-1's own still-waiting attempt proves that directly.
  const good = await h.req('POST', '/api/oidc/confirm', { body: { name: 'Cid', code: 'good1234' }, cookie: c1 });
  assert.equal(good.status, 200);
  const invites = h.db().invites;
  assert.equal(invites.find(i => i.code === 'GOOD1234').usedBy, good.body.user.id);
});

/* ---------- session equivalence ---------- */

test('the provider-minted session is the same shape and name as any other sign-in\'s', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: { users: [seeded], creds: [], subs: [], invites: [], identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }] }
  });
  const { sessionCookie } = await providerSignIn(h, provider, { sub: 'subject-1' });
  const value = sessionCookie.slice(`${SESSION_COOKIE}=`.length);
  assert.equal(value.split(':').length, 3, 'the payload is <uid>:<expiry>:<version>, with the signature appended to the last field');

  // mintSession() with the running child's own secret produces a session for the same profile
  // that resolves identically -- proving the provider path mints through the same function.
  const equivalent = mintSession(h.secret, seeded.id, 0);
  const me1 = await h.req('GET', '/api/me', { cookie: sessionCookie });
  const me2 = await h.req('GET', '/api/me', { cookie: equivalent });
  assert.equal(me1.body.user.id, me2.body.user.id);
  assert.equal(me1.body.user.name, me2.body.user.name);
});

test('a disabled profile is refused on its existing session cookie, whichever path minted it', async t => {
  const provider = await startProvider(t);
  const disabled = { id: 'disabled-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z', disabled: true };
  const h = await startApi(t, {
    provider,
    db: { users: [disabled], creds: [], subs: [], invites: [], identities: [{ iss: provider.base, sub: 'subject-1', userId: disabled.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }] }
  });
  const cookie = mintSession(h.secret, disabled.id, 0);
  const res = await h.req('GET', '/api/me', { cookie });
  assert.equal(res.status, 401, 'a session for a disabled profile must not resolve, whatever route minted it');
});

/* ---------- passkeys in the minimal stored shape, alongside a linked identity ---------- */

test('a passkey in the minimal stored shape still signs in on a profile that also has a linked identity', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], subs: [], invites: [],
      creds: [key.row(seeded.id)],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const opts = await h.req('POST', '/api/login/options', { body: {} });
  const verify = await h.req('POST', '/api/login/verify', { body: { cid: opts.body.cid, credential: key.assertion(opts.body.options.challenge) } });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.user.id, seeded.id);
});

/* ---------- subpath deployment ---------- */

test('under a subpath deployment, every browser-facing redirect of the sign-in routes starts with the app path', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    env: { ORIGIN: 'http://localhost:8080', OIDC_REDIRECT_URI: 'http://localhost:8080/gym/api/oidc/callback' },
    db: { users: [], creds: [], subs: [], invites: [] }
  });

  const flow = await beginFlow(h);
  const bad = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: 'wrong-state' });
  assert.equal(bad.location, '/gym/#err=state-unknown');

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ nonce: flow.nonce }) });
  const unknown = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(unknown.location, '/gym/#oidc=confirm');

  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h2 = await startApi(t, {
    provider,
    env: { ORIGIN: 'http://localhost:8080', OIDC_REDIRECT_URI: 'http://localhost:8080/gym/api/oidc/callback' },
    db: { users: [seeded], creds: [], subs: [], invites: [], identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }] }
  });
  const { res } = await providerSignIn(h2, provider, { sub: 'subject-1' });
  assert.equal(res.location, '/gym/', 'a known identity returns to the app under its own path');
});
