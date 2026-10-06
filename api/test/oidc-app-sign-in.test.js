/* Proves the phone app's sign-in through the provider against a spawned server and an in-process
 * provider: a linked identity departs through the app's own start route, returns to the app's
 * custom scheme with a one-shot code, and redeems it - bound to the app's own verifier - for the
 * exact token shape POST /api/pair/redeem already answers with. Never a web screen, never a
 * session cookie on the departed browser, and never a code that another app's verifier can spend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProvider, startApi, beginFlow, completeCallback, cookieValue, mintSession,
  appPkce, appDepart, appReturnOf, appSignIn, appRedeem, appConfirm,
  ST_COOKIE, SESSION_COOKIE
} from './oidc-harness.mjs';

const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');

// Expiry past APP_CODE_TTL_MS is already proven at the flow-store level, with an injected clock
// (api/test/oidc-flow.test.js) - nothing here re-proves it by sleeping a minute.

/* ---------- a linked identity signs in from the phone app ---------- */

test('a linked identity departs through the app\'s start route and returns with a redeemable code', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const before = dbSnapshot(h);

  const pkce = appPkce();
  const depart = await appDepart(h, pkce.challenge);
  const loc = new URL(depart.res.location, h.api);
  assert.equal(loc.origin + loc.pathname, provider.base + '/authorize', 'the departure still carries the server\'s own redirect_uri to the provider');
  // The app's own S256 challenge never travels to the provider - only the server's own
  // provider-facing PKCE pair (departTo's own pkce.challenge) does.
  assert.notEqual(depart.res.query.get('code_challenge'), pkce.challenge);

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: depart.nonce }) });
  const callback = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  assert.equal(cookieValue(callback.cookies, SESSION_COOKIE), null, 'an app departure never sets a session cookie on the browser that made it');
  assert.equal(cookieValue(callback.cookies, ST_COOKIE), '', 'the departure cookie is expired, not carried forward');
  const ret = appReturnOf(callback);
  assert.ok(ret?.code, 'the callback must return opengym://oidc?code=... for a linked identity');

  const redeem = await appRedeem(h, { code: ret.code, verifier: pkce.verifier });
  assert.equal(redeem.status, 200);
  assert.equal(typeof redeem.body.token, 'string');
  assert.equal(redeem.body.token.split(':').length, 3, 'the payload is <uid>:<expiry>:<version>, with the signature appended to the last field');
  assert.deepEqual(redeem.body.user, { id: seeded.id, name: seeded.name, admin: false });

  const me = await h.req('GET', '/api/me', { headers: { Authorization: `Bearer ${redeem.body.token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, seeded.id);

  assert.equal(dbSnapshot(h), before, 'nothing about a known identity signing in writes to db.json');

  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'auth.oidc.app.ok' && e.uid === seeded.id));
  const dump = JSON.stringify(audit);
  assert.equal(dump.includes(ret.code), false, 'the raw return code must never reach the audit log');
  assert.equal(dump.includes(pkce.verifier), false, 'the verifier must never reach the audit log');
});

test('the same code redeemed with another verifier is refused, and nothing is minted', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });

  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(code, 'a linked identity must depart with a redeemable code');

  const wrongVerifier = appPkce().verifier;
  assert.notEqual(wrongVerifier, verifier);
  const wrong = await appRedeem(h, { code, verifier: wrongVerifier });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'verifier-mismatch');
  assert.equal(wrong.body.token, undefined);

  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'auth.oidc.app.fail' && e.msg === 'verifier-mismatch' && e.ok === false));

  // The code was consumed by the first (wrong) redeem attempt - a one-shot store, not a retry
  // budget - so even the correct verifier now finds nothing to spend.
  const retry = await appRedeem(h, { code, verifier });
  assert.equal(retry.status, 400);
  assert.equal(retry.body.code, 'state-unknown');
  assert.equal(retry.body.token, undefined);
});

/* ---------- a verifier missing, malformed or wrong is refused the same way ---------- */

test('a redeem with no verifier at all is refused like a wrong one: 403 verifier-mismatch, nothing minted', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code } = await appSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(code, 'a linked identity must depart with a redeemable code');
  const redeem = await appRedeem(h, { code });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'verifier-mismatch');
  assert.equal(redeem.body.token, undefined);
});

test('a redeem with a 42-character verifier is refused the same way', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code } = await appSignIn(h, provider, { sub: 'subject-1' });
  const redeem = await appRedeem(h, { code, verifier: 'a'.repeat(42) });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'verifier-mismatch');
  assert.equal(redeem.body.token, undefined);
});

test('a redeem with a verifier containing a character outside RFC 7636\'s unreserved set is refused the same way', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code } = await appSignIn(h, provider, { sub: 'subject-1' });
  const redeem = await appRedeem(h, { code, verifier: 'a'.repeat(42) + '+' });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'verifier-mismatch');
  assert.equal(redeem.body.token, undefined);
});

/* ---------- unknown and reused codes ---------- */

test('an unknown code is refused with state-unknown, and the audit record names neither the code nor its hash', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const bogusCode = 'x'.repeat(40);
  const redeem = await appRedeem(h, { code: bogusCode, verifier: appPkce().verifier });
  assert.equal(redeem.status, 400);
  assert.equal(redeem.body.code, 'state-unknown');
  assert.equal(redeem.body.token, undefined);
  const audit = h.audit();
  const entry = audit.find(e => e.ev === 'auth.oidc.app.fail' && e.msg === 'app-code-invalid');
  assert.ok(entry, 'the refusal must be audited');
  assert.equal(JSON.stringify(entry).includes(bogusCode), false, 'the raw code must never reach the audit log');
});

test('the same code redeemed a second time, even with the right verifier both times, finds nothing: state-unknown', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-1' });
  const first = await appRedeem(h, { code, verifier });
  assert.equal(first.status, 200);
  const second = await appRedeem(h, { code, verifier });
  assert.equal(second.status, 400);
  assert.equal(second.body.code, 'state-unknown');
  assert.equal(second.body.token, undefined);
});

/* ---------- "sign out everywhere" reaching the phone's token ---------- */

test('a token redeemed through the provider stops working on GET /api/me after sign out everywhere', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-1' });
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 200);
  const token = redeem.body.token;
  const before = await h.req('GET', '/api/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(before.status, 200);
  const out = await h.req('POST', '/api/logout/all', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(out.status, 200);
  const after = await h.req('GET', '/api/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(after.status, 401);
});

test('signing out everywhere between the callback and the redeem answers session-changed, and mints nothing', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-1' });
  const raw = mintSession(h.secret, seeded.id);
  const bearer = raw.slice(raw.indexOf('=') + 1);
  const out = await h.req('POST', '/api/logout/all', { headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(out.status, 200);
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 401);
  assert.equal(redeem.body.code, 'session-changed');
  assert.equal(redeem.body.token, undefined);
});

/* ---------- a disabled account, at the callback and between the callback and the redeem ---------- */

test('an identity linked to a disabled profile is refused at the callback, before any code is minted', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z', disabled: true };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code, err } = await appSignIn(h, provider, { sub: 'subject-1' });
  assert.equal(err, 'account-disabled');
  assert.equal(code, null, 'nothing may be minted for a disabled account');
  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'auth.oidc.app.fail' && e.msg === 'account-disabled' && e.ok === false));
});

test('a profile disabled between the callback and the redeem is refused at the redeem', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const admin = { id: 'admin-1', name: 'Admin', created: '2026-01-01T00:00:00.000Z', admin: true };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded, admin], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(code);
  const disable = await h.req('POST', '/api/admin/user/disable', { body: { id: seeded.id, disabled: true }, cookie: mintSession(h.secret, admin.id) });
  assert.equal(disable.status, 200);
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'account-disabled');
});

/* ---------- GET /api/oidc/app/start: refusals before a departure is ever recorded ---------- */

test('a missing, 42-character, or malformed challenge is refused before anything is recorded, and a later valid departure still completes', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const malformed = [null, 'a'.repeat(42), 'a'.repeat(42) + '=', 'a'.repeat(42) + '+'];
  for (const challenge of malformed) {
    const res = challenge === null
      ? await h.raw('GET', '/api/oidc/app/start')
      : await h.raw('GET', `/api/oidc/app/start?challenge=${encodeURIComponent(challenge)}`);
    assert.equal(appReturnOf(res)?.err, 'request-invalid', `challenge=${challenge}`);
    assert.equal(cookieValue(res.cookies, ST_COOKIE) || '', '', `challenge=${challenge} must record nothing`);
  }
  // A second, genuine departure still works - the malformed attempts above spent none of the
  // per-address departure window in a way that would stop it.
  const { code } = await appSignIn(h, provider, { sub: 'subject-1' });
  assert.ok(code, 'a genuine departure must still complete after the malformed attempts');
});

test('GET /api/oidc/app/start requested as anything but a navigation is bluntly refused, with no cookie', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const res = await h.raw('GET', `/api/oidc/app/start?challenge=${'a'.repeat(43)}`, { headers: { 'Sec-Fetch-Dest': 'image' } });
  assert.equal(res.status, 403);
  assert.equal(res.location, null);
  assert.equal(cookieValue(res.cookies, ST_COOKIE) || '', '');
});

test('GET /api/oidc/app/start with the provider unreachable answers err=provider-unreachable, audited', async t => {
  const dead = { base: 'http://127.0.0.1:1', clientId: 'opengym-test-client' };
  const h = await startApi(t, { provider: dead, db: { users: [], creds: [], subs: [], invites: [] } });
  const depart = await appDepart(h, appPkce().challenge);
  assert.equal(appReturnOf(depart.res)?.err, 'provider-unreachable');
  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'auth.oidc.app.fail' && e.msg === 'provider-unreachable' && e.ok === false));
});

test('GET /api/oidc/app/start with no valid provider configuration answers err=provider-misconfigured', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { OIDC_CLIENT_ID: '' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const depart = await appDepart(h, appPkce().challenge);
  assert.equal(appReturnOf(depart.res)?.err, 'provider-misconfigured');
});

/* ---------- an app departure's callback, refused after the provider round trip ---------- */

test('an app departure whose callback carries the provider\'s own error parameter answers err=token-invalid, mints nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const depart = await appDepart(h, appPkce().challenge);
  const res = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state, error: 'access_denied' });
  assert.equal(appReturnOf(res)?.err, 'token-invalid');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  assert.equal(dbSnapshot(h), before, 'a fresh data directory stays without a written db.json');
});

test('an app departure whose token endpoint answers 500 gives the app the same failure code the web path gets', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const depart = await appDepart(h, appPkce().challenge);
  provider.setTokenResponse(500, {});
  const res = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  assert.equal(appReturnOf(res)?.err, 'provider-unreachable');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  assert.equal(dbSnapshot(h), before);
});

/* ---------- a web departure for the same identity is unaffected ---------- */

test('a web departure for the same identity still lands on the web app with a session cookie, and an appChallenge on its callback query changes nothing', async t => {
  const provider = await startProvider(t);
  const seeded = { id: 'seeded-1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [seeded], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: seeded.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });

  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: flow.nonce }) });
  // A crafted callback query naming an appChallenge that was never recorded at departure time -
  // the callback must read the flag only from the consumed departure entry, never from here.
  const res = await h.raw(
    'GET',
    `/api/oidc/callback?code=authcode-from-provider&state=${encodeURIComponent(flow.state)}&appChallenge=${encodeURIComponent('x'.repeat(43))}`,
    { cookie: flow.cookieHeader }
  );
  assert.equal(res.status, 302);
  assert.equal(res.location, '/');
  const session = cookieValue(res.cookies, SESSION_COOKIE);
  assert.ok(session, 'a web departure for a linked identity must still mint a session cookie, appChallenge query or not');
});

/* ---------- a new profile from the phone: the confirm handle and POST /api/oidc/app/confirm ---------- */

test('an unlinked identity redeems to a confirmation answer carrying a one-shot handle and the seeded name, and writes nothing yet', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new', extra: { name: 'Sam Seeded' } });
  assert.ok(code, 'an unlinked identity must still depart with a redeemable code');
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 200);
  assert.equal(typeof redeem.body.confirm?.handle, 'string');
  assert.equal(redeem.body.confirm.name, 'Sam Seeded');
  assert.equal(redeem.body.confirm.invite, false);
  assert.equal(redeem.body.token, undefined);
  assert.equal(dbSnapshot(h), before, 'nothing may be written before the confirm');
});

test('POST /api/oidc/app/confirm creates exactly one user and one identity row, and the token it answers works', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const redeem = await appRedeem(h, { code, verifier });
  const { handle } = redeem.body.confirm;

  const confirm = await appConfirm(h, { handle, name: 'Confirmed Sam' });
  assert.equal(confirm.status, 200);
  assert.equal(typeof confirm.body.token, 'string');
  assert.equal(confirm.body.user.name, 'Confirmed Sam');

  const db = h.db();
  assert.equal(db.users.length, 1);
  assert.equal(db.identities.length, 1);
  assert.equal(db.identities[0].userId, db.users[0].id);

  const me = await h.req('GET', '/api/me', { headers: { Authorization: `Bearer ${confirm.body.token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, db.users[0].id);

  const audit = h.audit();
  assert.ok(audit.some(e => e.ev === 'auth.oidc.app.new'));
});

test('a blank name is refused with 400 and leaves the handle usable; a name over 40 characters is cut to 40', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const before = dbSnapshot(h);
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const { handle } = (await appRedeem(h, { code, verifier })).body.confirm;

  const blank = await appConfirm(h, { handle, name: '   ' });
  assert.equal(blank.status, 400);
  assert.equal(dbSnapshot(h), before);

  const long = await appConfirm(h, { handle, name: 'x'.repeat(60) });
  assert.equal(long.status, 200);
  assert.equal(long.body.user.name.length, 40);
});

test('the handle is one-shot: a second confirm answers 401 and creates no second user', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const { handle } = (await appRedeem(h, { code, verifier })).body.confirm;

  const first = await appConfirm(h, { handle, name: 'Ana' });
  assert.equal(first.status, 200);
  const second = await appConfirm(h, { handle, name: 'Ana Again' });
  assert.equal(second.status, 401);
  assert.equal(h.db().users.length, 1);
});

test('two confirms for an identity that got linked meanwhile resolve to the existing profile with a token', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });

  const first = await appSignIn(h, provider, { sub: 'subject-new' });
  const handle1 = (await appRedeem(h, { code: first.code, verifier: first.verifier })).body.confirm.handle;
  const second = await appSignIn(h, provider, { sub: 'subject-new' });
  const handle2 = (await appRedeem(h, { code: second.code, verifier: second.verifier })).body.confirm.handle;

  const confirm1 = await appConfirm(h, { handle: handle1, name: 'Ana' });
  assert.equal(confirm1.status, 200);
  const confirm2 = await appConfirm(h, { handle: handle2, name: 'Ana From The Second Attempt' });
  assert.equal(confirm2.status, 200, 'the second attempt resolves to the profile the first one already made');
  assert.equal(confirm2.body.user.id, confirm1.body.user.id);
  assert.equal(typeof confirm2.body.token, 'string');
  assert.equal(h.db().users.length, 1);
  assert.equal(h.db().identities.length, 1);
});

test('on an invite-only instance the confirmation answer says invite: true', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { INVITE_ONLY: '1' }, db: { users: [], creds: [], subs: [], invites: [] } });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.body.confirm.invite, true);
});

test('on an invite-only instance, a missing, used or revoked code is refused with invite-invalid, and the same handle then succeeds with a valid one', async t => {
  const provider = await startProvider(t);
  const usedInvite = { code: 'USED1234', usedBy: 'someone-else', revoked: false };
  const goodInvite = { code: 'GOOD1234', usedBy: null, revoked: false };
  const h = await startApi(t, { provider, env: { INVITE_ONLY: '1' }, db: { users: [], creds: [], subs: [], invites: [usedInvite, goodInvite] } });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const { handle } = (await appRedeem(h, { code, verifier })).body.confirm;

  const noCode = await appConfirm(h, { handle, name: 'Ana' });
  assert.equal(noCode.status, 403);
  assert.equal(noCode.body.code, 'invite-invalid');

  const used = await appConfirm(h, { handle, name: 'Ana', code: 'used1234' });
  assert.equal(used.status, 403);
  assert.equal(used.body.code, 'invite-invalid');
  assert.equal(h.db().users.length, 0, 'none of the refusals may have spent the handle');

  const good = await appConfirm(h, { handle, name: 'Ana', code: 'good1234' });
  assert.equal(good.status, 200);
  assert.equal(h.db().invites.find(i => i.code === 'GOOD1234').usedBy, good.body.user.id);
});

test('on an invite-only instance, an identity already linked redeems straight to a token and is never asked for an invite', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider, env: { INVITE_ONLY: '1' },
    db: { users: [], creds: [], subs: [], invites: [{ code: 'GOOD1234', usedBy: null, revoked: false }] }
  });

  const first = await appSignIn(h, provider, { sub: 'subject-new' });
  const handle1 = (await appRedeem(h, { code: first.code, verifier: first.verifier })).body.confirm.handle;
  const created = await appConfirm(h, { handle: handle1, name: 'Ana', code: 'good1234' });
  assert.equal(created.status, 200);

  // A fresh departure for the same identity, now linked: the callback resolves it like any other
  // returning sign-in, and the redeem answers a token directly - never a confirmation, never
  // asking for the invite a second time.
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 200);
  assert.equal(typeof redeem.body.token, 'string');
  assert.equal(redeem.body.confirm, undefined);
  assert.equal(redeem.body.user.id, created.body.user.id);
});

test('a disabled profile reached through a double submission answers 403 account-disabled', async t => {
  const provider = await startProvider(t);
  const admin = { id: 'admin-1', name: 'Admin', created: '2026-01-01T00:00:00.000Z', admin: true };
  const h = await startApi(t, { provider, db: { users: [admin], creds: [], subs: [], invites: [] } });

  const first = await appSignIn(h, provider, { sub: 'subject-new' });
  const handle1 = (await appRedeem(h, { code: first.code, verifier: first.verifier })).body.confirm.handle;
  const second = await appSignIn(h, provider, { sub: 'subject-new' });
  const handle2 = (await appRedeem(h, { code: second.code, verifier: second.verifier })).body.confirm.handle;

  const confirm1 = await appConfirm(h, { handle: handle1, name: 'Ana' });
  assert.equal(confirm1.status, 200);
  const disable = await h.req('POST', '/api/admin/user/disable', { body: { id: confirm1.body.user.id, disabled: true }, cookie: mintSession(h.secret, admin.id) });
  assert.equal(disable.status, 200);

  const confirm2 = await appConfirm(h, { handle: handle2, name: 'ignored' });
  assert.equal(confirm2.status, 403);
  assert.equal(confirm2.body.code, 'account-disabled');
});

test('POST /api/oidc/app/confirm answers a WebView\'s cross-site request, exactly like POST /api/oidc/app/redeem', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [], creds: [], subs: [], invites: [] } });
  const { code, verifier } = await appSignIn(h, provider, { sub: 'subject-new' });
  const { handle } = (await appRedeem(h, { code, verifier })).body.confirm;
  const confirm = await appConfirm(h, { handle, name: 'Ana' });
  assert.notEqual(confirm.status, 403, 'a cross-site WebView request must not be refused as cross-origin');
  assert.equal(confirm.status, 200);
});
