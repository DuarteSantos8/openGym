/* Proves linking an identity to a profile from the phone app against a spawned server and an
 * in-process provider double. The phone is played by requests carrying
 * `Authorization: Bearer <session value>` and no Cookie header at all, plus a WebView's own
 * cross-site headers (appLinkTicket/appDepartLink/appRedeem below) - the system browser the
 * departure leaves for has no session of its own, and the redeem is the one point the phone
 * presents both its verifier and its Bearer.
 *
 * The web link suite (oidc-link.test.js) is untouched by this plan and proves the rules this file
 * exercises over the app channel instead - this file does not re-derive them, only proves the
 * phone's own path to the same outcome.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProvider, startApi, mintSession, bearerOf, withPassword, appPkce,
  appLinkTicket, appDepartLink, appReturnOf, appRedeem, completeCallback, beginLink,
  cookieValue, SESSION_COOKIE
} from './oidc-harness.mjs';

const PASSWORD = 'correct horse battery staple';
const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');

// A profile with a current password, the proof a Bearer session uses here (a passkey assertion
// needs a WebAuthn ceremony the phone's own WebView cannot run).
async function withPasswordUser(t, over = {}) {
  const provider = await startProvider(t);
  const pw = await withPassword(PASSWORD);
  const user = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z', pw, ...over };
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: { users: [user], creds: [], subs: [], invites: [] } });
  const bearer = bearerOf(mintSession(h.secret, user.id));
  return { provider, h, user, bearer };
}

/* ---------- link-ticket's own challenge field ---------- */

test('link-ticket over a Bearer session with the current password mints a ticket carrying the challenge', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const res = await appLinkTicket(h, bearer, { current: PASSWORD }, challenge);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ticket, 'string');
});

test('the same request over a cookie session answers 400 challenge-invalid, before any proof is asked', async t => {
  const { h, user } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const cookie = mintSession(h.secret, user.id);
  const res = await h.req('POST', '/api/account/identities/link-ticket', { body: { challenge }, cookie });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'challenge-invalid');
  assert.equal(h.audit().length, 0, 'refused before any proof is asked, so nothing is audited');
});

test('a malformed challenge over a Bearer session answers 400 challenge-invalid', async t => {
  const { h, bearer } = await withPasswordUser(t);
  for (const bad of ['', 'too-short', 'x'.repeat(44), 'not-base64url-chars-!!'.padEnd(43, 'x')]) {
    const res = await appLinkTicket(h, bearer, { current: PASSWORD }, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.code, 'challenge-invalid');
  }
});

test('an app link-ticket request with no proof is refused the web\'s own rule (current-required)', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const res = await appLinkTicket(h, bearer, {}, challenge);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'current-required', 'a password-capable profile is asked for its current password, exactly as the web is');
});

test('a wrong current password over a Bearer session is refused, the web\'s own rule', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const res = await appLinkTicket(h, bearer, { current: 'not the password' }, challenge);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'current-wrong');
});

test('challenge omitted entirely mints an ordinary ticket with no appChallenge, the web\'s own shape', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const res = await appLinkTicket(h, bearer, { current: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ticket, 'string');
});

/* ---------- GET /api/oidc/app/link/start: the ticket-only departure ---------- */

test('app link/start with no cookie and no Authorization departs on the ticket alone', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const ticket = (await appLinkTicket(h, bearer, { current: PASSWORD }, challenge)).body.ticket;
  const depart = await appDepartLink(h, ticket);
  assert.equal(depart.res.status, 302);
  const loc = new URL(depart.res.location, h.api);
  assert.ok(loc.pathname.endsWith('/authorize'), 'must depart for the provider');
  assert.ok(depart.state, 'no state parameter');
  assert.ok(depart.nonce, 'no nonce parameter');
});

test('a spent, unknown or web ticket at the app departure answers opengym://oidc?err=ticket-invalid and records nothing', async t => {
  const { h, bearer } = await withPasswordUser(t);
  const before = h.audit().length;

  const unknown = await appDepartLink(h, 'nobody-ever-minted-this');
  assert.equal(appReturnOf(unknown.res)?.err, 'ticket-invalid');
  assert.equal(unknown.state, null);

  const { challenge } = appPkce();
  const ticket = (await appLinkTicket(h, bearer, { current: PASSWORD }, challenge)).body.ticket;
  const first = await appDepartLink(h, ticket);
  assert.ok(first.state, 'the first departure must succeed, or the case proves nothing');
  const second = await appDepartLink(h, ticket);
  assert.equal(appReturnOf(second.res)?.err, 'ticket-invalid', 'a spent ticket must not depart twice');

  assert.equal(h.audit().length, before, 'an anonymous request names nobody, so nothing is recorded');
});

test('a web-shaped ticket (minted with no challenge) presented to the app departure finds nothing', async t => {
  const { h, bearer } = await withPasswordUser(t);
  // A ticket minted with no challenge is exactly the shape GET /api/oidc/link/start itself mints
  // for - the app departure must refuse it just as it refuses an unknown one.
  const webShaped = (await appLinkTicket(h, bearer, { current: PASSWORD })).body.ticket;
  const res = await appDepartLink(h, webShaped);
  assert.equal(appReturnOf(res.res)?.err, 'ticket-invalid');
});

test('the web GET /api/oidc/link/start refuses an app ticket exactly as an unknown one', async t => {
  const { h, user, bearer } = await withPasswordUser(t);
  const { challenge } = appPkce();
  const ticket = (await appLinkTicket(h, bearer, { current: PASSWORD }, challenge)).body.ticket;
  const cookie = mintSession(h.secret, user.id);
  const link = await beginLink(h, cookie, ticket);
  assert.equal(link.res.location, '/#/settings?link-err=ticket-invalid');
  assert.equal(link.state, null, 'nothing may depart for the provider');
});

/* ---------- GET /api/oidc/callback: the app link departure's return ---------- */

test('the callback of an app link departure answers opengym://oidc?code=..., and db.json is unchanged', async t => {
  const { provider, h, bearer } = await withPasswordUser(t);
  const before = dbSnapshot(h);
  const { challenge } = appPkce();
  const ticket = (await appLinkTicket(h, bearer, { current: PASSWORD }, challenge)).body.ticket;
  const depart = await appDepartLink(h, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: depart.nonce }) });
  const callback = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  assert.equal(cookieValue(callback.cookies, SESSION_COOKIE), null, 'an app link callback never sets a session cookie');
  const ret = appReturnOf(callback);
  assert.ok(ret?.code, 'the callback must return opengym://oidc?code=...');
  assert.equal(dbSnapshot(h), before, 'nothing is written until the redeem');
});

/* ---------- POST /api/oidc/app/redeem: the link mode ---------- */

// Drives the full ticket -> departure -> callback round trip for an app link, and answers
// { code, verifier } for the case to redeem however it likes.
async function appLinkDepartAndReturn(h, provider, bearer, { sub = 'subject-1', email, email_verified } = {}) {
  const pkce = appPkce();
  const ticket = (await appLinkTicket(h, bearer, { current: PASSWORD }, pkce.challenge)).body.ticket;
  const depart = await appDepartLink(h, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: depart.nonce, email, email_verified }) });
  const callback = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  const { code } = appReturnOf(callback);
  return { code, verifier: pkce.verifier };
}

// The full round trip, redeemed immediately with the given Bearer (defaulting to the one that
// started it).
async function appLink(h, provider, bearer, opts = {}) {
  const { code, verifier } = await appLinkDepartAndReturn(h, provider, bearer, opts);
  return appRedeem(h, { code, verifier }, { bearer: opts.redeemAs ?? bearer });
}

test('redeeming with the verifier and the same Bearer answers 200 { linked: true }, writes one identity row, audited auth.identity.link.ok', async t => {
  const { provider, h, bearer, user } = await withPasswordUser(t);
  const redeem = await appLink(h, provider, bearer);
  assert.equal(redeem.status, 200);
  assert.deepEqual(redeem.body, { linked: true });
  assert.equal(h.db().identities.length, 1);
  assert.equal(h.db().identities[0].userId, user.id);
  const ok = h.audit().find(r => r.ev === 'auth.identity.link.ok');
  assert.ok(ok, 'the success must be audited');
  assert.equal(ok.uid, user.id);
});

test('redeeming without Authorization answers 401 session-changed, audited auth.identity.link.fail, and writes nothing', async t => {
  const { provider, h, bearer } = await withPasswordUser(t);
  const { code, verifier } = await appLinkDepartAndReturn(h, provider, bearer);
  const before = dbSnapshot(h);
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 401);
  assert.equal(redeem.body.code, 'session-changed');
  const fail = h.audit().find(r => r.ev === 'auth.identity.link.fail' && r.msg === 'session-changed');
  assert.ok(fail);
  assert.equal(dbSnapshot(h), before);
});

test('redeeming with another session\'s Bearer answers 401 session-changed, and writes nothing', async t => {
  const { provider, h, bearer, user } = await withPasswordUser(t);
  const { code, verifier } = await appLinkDepartAndReturn(h, provider, bearer);
  const before = dbSnapshot(h);
  await new Promise(r => setTimeout(r, 2));
  const other = bearerOf(mintSession(h.secret, user.id));
  const redeem = await appRedeem(h, { code, verifier }, { bearer: other });
  assert.equal(redeem.status, 401);
  assert.equal(redeem.body.code, 'session-changed');
  assert.equal(dbSnapshot(h), before);
});

test('redeeming after POST /api/logout/all answers 401 session-changed, and writes nothing', async t => {
  const { provider, h, bearer } = await withPasswordUser(t);
  const { code, verifier } = await appLinkDepartAndReturn(h, provider, bearer);
  const out = await h.req('POST', '/api/logout/all', { headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(out.status, 200, 'the sign-out itself must succeed, or the case proves nothing');
  const before = dbSnapshot(h);
  const redeem = await appRedeem(h, { code, verifier }, { bearer });
  assert.equal(redeem.status, 401);
  assert.equal(redeem.body.code, 'session-changed');
  assert.equal(dbSnapshot(h), before);
});

test('redeeming with another verifier answers 403 verifier-mismatch, and writes nothing', async t => {
  const { provider, h, bearer } = await withPasswordUser(t);
  const { code } = await appLinkDepartAndReturn(h, provider, bearer);
  const before = dbSnapshot(h);
  const redeem = await appRedeem(h, { code, verifier: appPkce().verifier }, { bearer });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'verifier-mismatch');
  assert.equal(dbSnapshot(h), before);
});

/* ---------- attachIdentity's own rules, over the app channel ---------- */

test('a pair already linked to another profile answers 409 identity-collision, and writes nothing', async t => {
  const provider = await startProvider(t);
  const pw = await withPassword(PASSWORD);
  const user = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z', pw };
  const holder = { id: 'holder-1', name: 'Holder', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider, env: { PASSWORD_LOGIN: '1' },
    db: {
      users: [user, holder], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: holder.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const bearer = bearerOf(mintSession(h.secret, user.id));
  const redeem = await appLink(h, provider, bearer);
  assert.equal(redeem.status, 409);
  assert.equal(redeem.body.code, 'identity-collision');
  assert.equal(h.db().identities.length, 1, 'the identity must still point only at the profile that already held it');
});

test('the same owner linking the pair it already holds answers 200 { linked: true }, and writes nothing more', async t => {
  // Both attempts have to mint and depart before either resolves: once the first is redeemed the
  // identity is linked, and a second ticket mint for the same profile would be refused
  // profile-linked before it ever reached a departure - the same race oidc-link.test.js's own
  // "linking the same identity from two racing attempts" exercises, for the same reason.
  const { provider, h, bearer, user } = await withPasswordUser(t);
  const a = await appLinkDepartAndReturn(h, provider, bearer, { sub: 'subject-1' });
  const b = await appLinkDepartAndReturn(h, provider, bearer, { sub: 'subject-1' });

  const first = await appRedeem(h, a, { bearer });
  assert.equal(first.status, 200, 'the first link must succeed, or the case proves nothing');
  assert.equal(h.db().identities.length, 1);

  const second = await appRedeem(h, b, { bearer });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { linked: true });
  assert.equal(h.db().identities.length, 1, 'a repeated link must not double-write');
  assert.equal(h.db().identities[0].userId, user.id);
});

test('a profile that got linked meanwhile answers 409 profile-linked', async t => {
  const { provider, h, bearer } = await withPasswordUser(t);

  const a = await appLinkDepartAndReturn(h, provider, bearer, { sub: 'subject-A' });
  const b = await appLinkDepartAndReturn(h, provider, bearer, { sub: 'subject-B' });

  const redeemA = await appRedeem(h, a, { bearer });
  assert.equal(redeemA.status, 200, 'the first redeem to resolve must succeed, or the case proves nothing');

  const redeemB = await appRedeem(h, b, { bearer });
  assert.equal(redeemB.status, 409);
  assert.equal(redeemB.body.code, 'profile-linked');
  assert.equal(h.db().identities.length, 1);
});
