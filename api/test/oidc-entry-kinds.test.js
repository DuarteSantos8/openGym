/* Every key an OIDC route reads addresses exactly one kind of entry: a departure (sign-in, link or
 * proof, addressed by its `state`), a link or proof ticket, an identity waiting for its name, or a
 * proof made at the provider. A key of one kind presented where another is expected must find
 * nothing, and must not spend the entry it really addresses.
 *
 * The first case is the one that matters most: a departure's `state` is readable by whoever
 * started it (it rides in the redirect to the provider), so if it could be presented as the
 * waiting-identity cookie, anyone could create a profile with no identity behind it and then be
 * signed into that profile by repeating the trick.
 *
 * Everything here runs against a real spawned server and a real in-process provider double.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startProvider, startApi, mintSession, softAuthenticator, stepUp, beginFlow, completeCallback,
  providerSignIn, linkTicket, beginLink, proofTicket, beginProof, proofRoundTrip, cookieValue,
  ST_COOKIE, PENDING_COOKIE, PROOF_COOKIE, SESSION_COOKIE
} from './oidc-harness.mjs';

const USER = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const linked = provider => ({ iss: provider.base, sub: 'subject-1', userId: USER.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' });
const empty = () => ({ users: [], creds: [], subs: [], invites: [] });
const noSession = res => assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null, 'no session cookie may be set');

// Completes a sign-in departure the way a browser would, proving it was not spent by whatever
// was tried with its state before.
async function departureStillCompletes(h, provider, flow, sub = 'subject-9') {
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: flow.nonce }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(res.fragment.get('oidc'), 'confirm', 'the departure must still complete');
}

/* ---------- a departure's state is never a waiting identity ---------- */

test('a sign-in state presented as the waiting-identity cookie creates no profile, no identity and no session, however often it is tried', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { INVITE_ONLY: '1' }, db: { ...empty(), invites: [{ code: 'ABC123', created: '2026-01-01T00:00:00.000Z' }] } });
  for (let i = 0; i < 2; i++) {
    const flow = await beginFlow(h);
    assert.ok(flow.state, 'the departure must be minted, or the case proves nothing');
    const confirm = await h.req('POST', '/api/oidc/confirm', { body: { name: 'x', code: 'ABC123' }, cookie: `${PENDING_COOKIE}=${flow.state}` });
    assert.equal(confirm.status, 401);
    assert.equal(confirm.body.code, 'state-unknown');
    noSession(confirm);
    const db = h.db();
    assert.equal((db.users || []).length, 0, 'no profile may be created');
    assert.equal((db.identities || []).length, 0, 'no identity row may be written');
    assert.equal(db.invites[0].usedBy, undefined, 'the invite must not be spent');
  }
});

test('a sign-in state presented to the naming screen reads as an expired sign-in', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: empty() });
  const flow = await beginFlow(h);
  const pending = await h.req('GET', '/api/oidc/pending', { cookie: `${PENDING_COOKIE}=${flow.state}` });
  assert.equal(pending.status, 401);
  assert.equal(pending.body.code, 'state-unknown');
  await departureStillCompletes(h, provider, flow);
});

/* ---------- a waiting identity is never a departure ---------- */

test('a waiting identity presented to the callback as a departure answers state-unknown and stays waiting', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: empty() });
  const { res } = await providerSignIn(h, provider, { sub: 'subject-new' });
  const pendingId = cookieValue(res.cookies, PENDING_COOKIE);
  assert.ok(pendingId, 'a new identity must be parked, or the case proves nothing');

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-other', nonce: 'whatever' }) });
  const replay = await completeCallback(h, { cookieHeader: `${ST_COOKIE}=${pendingId}`, state: pendingId });
  assert.equal(replay.location, '/#err=state-unknown');
  noSession(replay);

  const still = await h.req('GET', '/api/oidc/pending', { cookie: `${PENDING_COOKIE}=${pendingId}` });
  assert.equal(still.status, 200, 'the waiting identity must not be spent by it');
});

/* ---------- departures and tickets never stand in for a proof ---------- */

test('a sign-in state presented as the proof cookie proves nothing and leaves the departure alive', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const flow = await beginFlow(h);
  const options = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${cookie}; ${PROOF_COOKIE}=${flow.state}` });
  assert.equal(options.status, 403);
  assert.equal(options.body.code, 'identity-proof');
  await departureStillCompletes(h, provider, flow);
});

test('a proof ticket presented as the proof cookie proves nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const options = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${cookie}; ${PROOF_COOKIE}=${ticket}` });
  assert.equal(options.status, 403);
  assert.equal(options.body.code, 'identity-proof');
});

test('a proof made at the provider presented as the waiting-identity cookie creates nothing', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  assert.ok(proofCookie, 'the proof must be made, or the case proves nothing');
  const proofId = proofCookie.slice(proofCookie.indexOf('=') + 1);
  const confirm = await h.req('POST', '/api/oidc/confirm', { body: { name: 'x' }, cookie: `${PENDING_COOKIE}=${proofId}` });
  assert.equal(confirm.status, 401);
  assert.equal(h.db().users.length, 1, 'no second profile may be created');
  assert.equal(h.db().identities.length, 1);
});

/* ---------- each ticket opens only its own departure ---------- */

test('a link ticket presented to the proof departure starts nothing, and still opens the link departure', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], creds: [key.row(USER.id)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await linkTicket(h, cookie, await stepUp(h, key, cookie))).body.ticket;
  const proof = await beginProof(h, cookie, ticket);
  assert.equal(proof.res.location, '/#/settings?proof-err=state-expired');
  assert.equal(proof.state, null, 'nothing may depart for the provider');
  const link = await beginLink(h, cookie, ticket);
  assert.ok(link.state, 'the link ticket must not be spent by the wrong departure');
});

test('a proof ticket presented to the link departure starts nothing, and still opens the proof departure', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const link = await beginLink(h, cookie, ticket);
  assert.equal(link.res.location, '/#/settings?link-err=ticket-invalid');
  assert.equal(link.state, null, 'nothing may depart for the provider');
  const proof = await beginProof(h, cookie, ticket);
  assert.ok(proof.state, 'the proof ticket must not be spent by the wrong departure');
});

test('a sign-in state presented as a ticket starts nothing and leaves the sign-in in flight', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const flow = await beginFlow(h);
  const link = await beginLink(h, cookie, flow.state);
  assert.equal(link.state, null);
  const proof = await beginProof(h, null, flow.state);
  assert.equal(proof.state, null);
  await departureStillCompletes(h, provider, flow);
});

/* ---------- a flood of one kind evicts only its own kind ---------- */

test('a flood of sign-in departures past the store ceiling leaves tickets and waiting identities in place', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { ...empty(), users: [USER], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const { res } = await providerSignIn(h, provider, { sub: 'subject-new' });
  const pendingId = cookieValue(res.cookies, PENDING_COOKIE);
  assert.ok(ticket && pendingId, 'both entries must exist, or the case proves nothing');

  // Spread over many addresses so the per-address budget does not stop the flood first.
  const total = 5100;
  for (let i = 0; i < total; i += 100) {
    await Promise.all(Array.from({ length: 100 }, (_, j) =>
      h.raw('GET', '/api/oidc/start', { headers: { 'x-forwarded-for': `198.51.${(i + j) >> 8 & 255}.${(i + j) & 255}` } })));
  }

  const still = await h.req('GET', '/api/oidc/pending', { cookie: `${PENDING_COOKIE}=${pendingId}` });
  assert.equal(still.status, 200, 'the waiting identity must survive the flood');
  const proof = await beginProof(h, cookie, ticket);
  assert.ok(proof.state, 'the proof ticket must survive the flood');
});
