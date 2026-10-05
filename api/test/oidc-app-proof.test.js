/* Proves the provider proof from the phone app against a spawned server and an in-process
 * provider double. The phone is played by requests carrying `Authorization: Bearer <session
 * value>` and no Cookie header at all - the system browser the departure leaves for has no
 * session of its own, and the redeem is the one point the phone presents both its verifier and
 * its Bearer.
 *
 * The web proof suite (oidc-proof.test.js) is untouched by this plan and proves the rules this
 * file exercises over the app channel instead: the identity rule, the auth_time rule, and the
 * one-shot spend through proveOwner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProvider, startApi, mintSession, bearerOf, appPkce, withPassword,
  appProofTicket, appDepartProof, appReturnOf, appRedeem, completeCallback,
  cookieValue, SESSION_COOKIE, PROOF_COOKIE
} from './oidc-harness.mjs';

const USER = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const linked = (provider, over = {}) => ({ iss: provider.base, sub: 'subject-1', userId: USER.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z', ...over });
const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
const nowS = () => Math.floor(Date.now() / 1000);
const proofFails = h => h.audit().filter(r => r.ev === 'auth.proof.fail');

// A profile whose only way in is its linked identity - the case this proof exists for, Bearer
// session included.
async function providerOnlyBearer(t, { env = {} } = {}) {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env, db: { users: [USER], creds: [], subs: [], invites: [], identities: [linked(provider)] } });
  return { provider, h, bearer: bearerOf(mintSession(h.secret, USER.id)) };
}

/* ---------- proof-ticket's own challenge field, over the app channel ---------- */

test('a Bearer session of a profile with a usable linked identity mints a proof ticket with the challenge', async t => {
  const { h, bearer } = await providerOnlyBearer(t);
  const { challenge } = appPkce();
  const res = await appProofTicket(h, bearer, 'device-link', challenge);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ticket, 'string');
});

/* ---------- GET /api/oidc/app/proof/start: the ticket-only departure ---------- */

test('app proof/start departs with prompt=login and max_age=0, no session needed', async t => {
  const { h, bearer } = await providerOnlyBearer(t);
  const { challenge } = appPkce();
  const ticket = (await appProofTicket(h, bearer, 'device-link', challenge)).body.ticket;
  const depart = await appDepartProof(h, ticket);
  assert.equal(depart.res.status, 302);
  const dest = new URL(depart.res.location);
  assert.equal(dest.searchParams.get('prompt'), 'login');
  assert.equal(dest.searchParams.get('max_age'), '0');
  assert.ok(depart.state, 'no state parameter');
  assert.ok(depart.nonce, 'no nonce parameter');
});

test('the callback of an app proof departure answers opengym://oidc?code=..., and db.json is unchanged', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const before = dbSnapshot(h);
  const { challenge } = appPkce();
  const ticket = (await appProofTicket(h, bearer, 'device-link', challenge)).body.ticket;
  const depart = await appDepartProof(h, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: depart.nonce }) });
  const callback = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  assert.equal(cookieValue(callback.cookies, SESSION_COOKIE), null);
  assert.equal(cookieValue(callback.cookies, PROOF_COOKIE), null, 'an app proof callback never sets the web proof cookie either');
  const ret = appReturnOf(callback);
  assert.ok(ret?.code, 'the callback must return opengym://oidc?code=...');
  assert.equal(dbSnapshot(h), before, 'nothing is minted until the redeem');
});

/* ---------- POST /api/oidc/app/redeem: the proof mode ---------- */

// Drives ticket -> departure -> callback for an app proof, answering { code, verifier } for the
// case to redeem however it likes.
async function appProofDepartAndReturn(h, provider, bearer, { act = 'device-link', sub = 'subject-1', authTime } = {}) {
  const pkce = appPkce();
  const ticket = (await appProofTicket(h, bearer, act, pkce.challenge)).body.ticket;
  const depart = await appDepartProof(h, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: depart.nonce, auth_time: authTime }) });
  const callback = await completeCallback(h, { cookieHeader: depart.cookieHeader, state: depart.state });
  const { code } = appReturnOf(callback);
  return { code, verifier: pkce.verifier };
}

test('redeeming with the verifier and the same Bearer answers 200 { proof: <id> }', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const redeem = await appRedeem(h, { code, verifier }, { bearer });
  assert.equal(redeem.status, 200);
  assert.equal(typeof redeem.body.proof, 'string');
  assert.equal(proofFails(h).length, 0);
});

test('POST /api/account/device-link with that Bearer and { identityProof: true, proof } answers 200 with a code', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const res = await h.req('POST', '/api/account/device-link', {
    body: { identityProof: true, proof },
    headers: { Authorization: `Bearer ${bearer}` }
  });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.code, 'string');
  const ok = h.audit().find(r => r.ev === 'auth.link.create');
  assert.ok(ok, 'the change must be audited');
  assert.equal(ok.msg, 'identity', 'the audit names the proof kind that allowed it');
});

test('the same proof id presented again is refused 403 identity-proof', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const first = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(first.status, 200, 'the first spend must succeed, or the case proves nothing');
  const second = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'identity-proof');
});

test('a proof minted for one act is refused against another act (DELETE /api/account/identities), 403 identity-proof', async t => {
  // A password too, so the identity is not this profile's last way in - otherwise the route
  // refuses 409 last-way-in before proveOwner is ever asked, and the case would prove nothing.
  const provider = await startProvider(t);
  const pw = await withPassword('correct horse battery staple');
  const user = { ...USER, pw };
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: { users: [user], creds: [], subs: [], invites: [], identities: [linked(provider)] } });
  const bearer = bearerOf(mintSession(h.secret, user.id));
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer, { act: 'device-link' });
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const res = await h.req('DELETE', '/api/account/identities', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
  assert.equal(h.db().identities.length, 1, 'nothing was removed');
});

test('a proof presented under another Bearer session of the same profile is refused 403 identity-proof', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  await new Promise(r => setTimeout(r, 2));
  const other = bearerOf(mintSession(h.secret, USER.id));
  const res = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${other}` } });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
});

test('a proof presented after sign out everywhere is refused 403 identity-proof under the fresh session', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const out = await h.req('POST', '/api/logout/all', { headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(out.status, 200);
  const stale = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(stale.status, 401, 'the session that asked is over');
  const fresh = bearerOf(mintSession(h.secret, USER.id, 1));
  const res = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${fresh}` } });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
});

test('a proof id sent as the proof cookie on a Bearer request proves nothing', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const res = await h.req('POST', '/api/account/device-link', {
    body: { identityProof: true },
    headers: { Authorization: `Bearer ${bearer}`, Cookie: `${PROOF_COOKIE}=${proof}` }
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
  // the proof must survive, unread, to be spent correctly afterwards
  const ok = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(ok.status, 200, 'the carrier mix-up must not have spent the proof');
});

test('a body proof on a cookie session proves nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const bearer = bearerOf(cookie);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const { body: { proof } } = await appRedeem(h, { code, verifier }, { bearer });
  const res = await h.req('POST', '/api/account/device-link', { body: { identityProof: true, proof }, cookie });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
});

/* ---------- the identity and staleness rules, at the redeem ---------- */

test('a token naming another subject answers the redeem 403 identity-mismatch, audited with the act', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer, { sub: 'someone-else' });
  const redeem = await appRedeem(h, { code, verifier }, { bearer });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'identity-mismatch');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.msg, 'identity-mismatch');
  assert.equal(fail.act, 'device-link');
  assert.equal(fail.ok, false);
});

test('a reported auth_time older than the departure answers the redeem 403 stale-sign-in, audited with the act', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer, { authTime: nowS() - 600 });
  const redeem = await appRedeem(h, { code, verifier }, { bearer });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'stale-sign-in');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.msg, 'stale-sign-in');
  assert.equal(fail.act, 'device-link');
});

test('an identity unlinked between departure and redeem answers the redeem 403 identity-mismatch', async t => {
  // A password too, so removing the identity is not refused 409 last-way-in - the live db is
  // in-memory, so the identity has to be removed through the real route, not by editing the file.
  const provider = await startProvider(t);
  const pw = await withPassword('correct horse battery staple');
  const user = { ...USER, pw };
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: { users: [user], creds: [], subs: [], invites: [], identities: [linked(provider)] } });
  const bearer = bearerOf(mintSession(h.secret, user.id));
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);

  const removed = await h.req('DELETE', '/api/account/identities', { body: { current: 'correct horse battery staple' }, headers: { Authorization: `Bearer ${bearer}` } });
  assert.equal(removed.status, 200, 'the removal itself must succeed, or the case proves nothing');

  const redeem = await appRedeem(h, { code, verifier }, { bearer });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'identity-mismatch');
});

/* ---------- the redeem's Bearer-session and verifier checks ---------- */

test('redeeming without the same Bearer answers 401 session-changed; no proof is minted', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code, verifier } = await appProofDepartAndReturn(h, provider, bearer);
  const redeem = await appRedeem(h, { code, verifier });
  assert.equal(redeem.status, 401);
  assert.equal(redeem.body.code, 'session-changed');
});

test('redeeming with another verifier answers 403 verifier-mismatch; no proof is minted', async t => {
  const { provider, h, bearer } = await providerOnlyBearer(t);
  const { code } = await appProofDepartAndReturn(h, provider, bearer);
  const redeem = await appRedeem(h, { code, verifier: appPkce().verifier }, { bearer });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.body.code, 'verifier-mismatch');
});
