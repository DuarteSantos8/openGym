/* The owner's proof by a sign-in at the provider as the profile's own linked identity: the third
 * kind of proof, beside a passkey and the password, for a profile whose only way in may be that
 * identity.
 *
 * Two rules decide it. Always: the verified token names exactly the identity linked to the
 * profile - a stolen session cookie cannot complete a sign-in at the provider as the owner.
 * Only when the issuer reports auth_time: that sign-in must not predate the request (less the
 * clock skew). An issuer that never reports auth_time is not refused for that alone; its proof
 * shows possession of the linked account rather than a fresh sign-in.
 *
 * Everything here runs against a real spawned server and a real in-process provider double.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startProvider, startApi, mintSession, softAuthenticator, stepUp, completeCallback,
  proofTicket, beginProof, proofRoundTrip, cookieValue, ST_COOKIE, SESSION_COOKIE, PROOF_COOKIE
} from './oidc-harness.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const linked = (provider, over = {}) => ({ iss: provider.base, sub: 'subject-1', userId: USER.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z', ...over });
const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
const nowS = () => Math.floor(Date.now() / 1000);

// A profile whose only way in is its linked identity, the case this proof exists for.
async function providerOnly(t, { env = {} } = {}) {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env, db: { users: [USER], creds: [], subs: [], invites: [], identities: [linked(provider)] } });
  return { provider, h, cookie: mintSession(h.secret, USER.id) };
}

const proofFails = h => h.audit().filter(r => r.ev === 'auth.proof.fail');

/* ---------- POST /api/account/identities/proof-ticket ---------- */

test('proof-ticket with no session answers 401', async t => {
  const { h } = await providerOnly(t);
  const res = await proofTicket(h, null, 'passkey-add');
  assert.equal(res.status, 401);
});

test('proof-ticket without a change it can confirm answers act-invalid', async t => {
  const { h, cookie } = await providerOnly(t);
  for (const act of [undefined, '', 'rename', '__proto__', 'constructor', 42, ['passkey-add']]) {
    const res = await h.req('POST', '/api/account/identities/proof-ticket', { body: act === undefined ? {} : { act }, cookie });
    assert.equal(res.status, 400, `act ${JSON.stringify(act)}`);
    assert.equal(res.body.code, 'act-invalid');
  }
});

test('proof-ticket for a profile with no linked identity answers not-linked', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const res = await proofTicket(h, mintSession(h.secret, USER.id), 'passkey-add');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'not-linked');
});

test('proof-ticket with no provider configured answers not-linked, even with an identity stored', async t => {
  const { h, cookie } = await providerOnly(t, { env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' } });
  const res = await proofTicket(h, cookie, 'passkey-add');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'not-linked');
});

test('proof-ticket for a linked profile answers a 43-character ticket, and writes nothing', async t => {
  const { h, cookie } = await providerOnly(t);
  const before = dbSnapshot(h);
  const res = await proofTicket(h, cookie, 'passkey-add');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ticket, 'string');
  assert.equal(res.body.ticket.length, 43);
  assert.equal(dbSnapshot(h), before, 'a ticket lives in memory only');
});

test('proof-ticket sent cross-site is refused by the origin check', async t => {
  const { h, cookie } = await providerOnly(t);
  const res = await h.req('POST', '/api/account/identities/proof-ticket', { body: { act: 'passkey-add' }, cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'cross-origin request refused');
});

test('the changes a proof ticket can name are exactly the changes the server asks a proof for', () => {
  const src = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  const calls = new Set([...src.matchAll(/proveOwner\(req, res, user, body, '([a-z-]+)'\)/g)].map(m => m[1]));
  const block = /const PROOF_ACTS = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(block, 'PROOF_ACTS is not a Set literal in server.js');
  const listed = new Set([...block[1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
  assert.ok(calls.size >= 7, `only found ${calls.size} proveOwner call sites`);
  assert.deepEqual([...listed].sort(), [...calls].sort());
});

/* ---------- GET /api/oidc/proof/start ---------- */

test('proof/start with no ticket answers state-expired on Settings, and never names the provider', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const start = await beginProof(h, cookie, null);
  assert.equal(start.res.status, 302);
  assert.equal(start.res.location, '/#/settings?proof-err=state-expired');
  assert.equal(start.res.location.includes(provider.base), false);
  assert.ok(!cookieValue(start.res.cookies, ST_COOKIE), 'no addressable departure cookie');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.ok, false);
  assert.equal(fail.msg, 'ticket-invalid');
});

test('the same proof ticket presented twice: the second departure answers state-expired', async t => {
  const { h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const first = await beginProof(h, cookie, ticket);
  assert.ok(first.state, 'the first presentation must depart, or the case proves nothing');
  const second = await beginProof(h, cookie, ticket);
  assert.equal(second.res.location, '/#/settings?proof-err=state-expired');
});

test('a proof ticket presented under another session of the same profile answers state-unknown', async t => {
  const { h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  await new Promise(r => setTimeout(r, 2));
  const start = await beginProof(h, mintSession(h.secret, USER.id), ticket);
  assert.equal(start.res.location, '/#/settings?proof-err=state-unknown');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.msg, 'session-changed');
  assert.equal(fail.act, 'passkey-add');
  assert.equal(fail.ok, false);
});

test('a proof ticket presented with no session at all answers state-unknown', async t => {
  const { h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, null, ticket);
  assert.equal(start.res.location, '/#/settings?proof-err=state-unknown');
});

test('a proof ticket presented under another session or with no session is not spent, and still departs for its owner', async t => {
  const { h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  await new Promise(r => setTimeout(r, 2));
  const before = h.audit().length;
  const anonymous = await beginProof(h, null, ticket);
  assert.equal(anonymous.state, null);
  assert.equal(h.audit().length, before, 'an anonymous presentation records nothing');
  const other = await beginProof(h, mintSession(h.secret, USER.id), ticket);
  assert.equal(other.state, null);
  const own = await beginProof(h, cookie, ticket);
  assert.ok(own.state, 'the owner\'s ticket must survive every other presentation');
});

test('a proof return that lost its departure cookie on the way answers on Settings while signed in, and on the sign-in screen otherwise', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: start.nonce }) });
  // The departure cookie lives exactly as long as the attempt, so a slow trip through the
  // provider comes back without it.
  const signedIn = await completeCallback(h, { cookieHeader: cookie, state: start.state });
  assert.equal(signedIn.location, '/#/settings?oidc-err=state-unknown');
  assert.equal(cookieValue(signedIn.cookies, PROOF_COOKIE), null);
  const signedOut = await completeCallback(h, { cookieHeader: null, state: start.state });
  assert.equal(signedOut.location, '/#err=state-unknown');
});

test('a live proof ticket departs asking the provider to authenticate again, with no claims request', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  assert.equal(start.res.status, 302);
  const dest = new URL(start.res.location);
  assert.equal(dest.origin + dest.pathname, provider.base + '/authorize');
  assert.equal(dest.searchParams.get('prompt'), 'login');
  assert.equal(dest.searchParams.get('max_age'), '0');
  assert.equal(dest.searchParams.has('claims'), false, 'no claims request parameter is sent');
  assert.equal(dest.searchParams.get('response_type'), 'code');
  assert.ok(start.state, 'no state parameter');
  assert.ok(start.nonce, 'no nonce parameter');
  assert.ok(dest.searchParams.get('code_challenge'), 'no code_challenge parameter');
  assert.equal(dest.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(start.cookieHeader, `${ST_COOKIE}=${start.state}`);
  assert.equal(cookieValue(start.res.cookies, SESSION_COOKIE), null);
});

test('proof/start with the provider unreachable answers provider-unreachable on Settings', async t => {
  const dead = { base: 'http://127.0.0.1:1', clientId: 'opengym-test-client' };
  const h = await startApi(t, { provider: dead, db: { users: [USER], creds: [], subs: [], invites: [], identities: [linked(dead)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  assert.equal(start.res.location, '/#/settings?proof-err=provider-unreachable');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.msg, 'provider-unreachable');
  assert.equal(fail.act, 'passkey-add');
});

/* ---------- GET /api/oidc/callback: the proof return ---------- */

test('the linked identity, with a token that carries no auth_time, leaves a proof and nothing else', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const before = dbSnapshot(h);
  const { res, proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/#/settings?proof=ok');
  assert.ok(proofCookie, 'no proof cookie was set');
  const set = res.cookies.find(c => c.startsWith(PROOF_COOKIE + '='));
  assert.match(set, /HttpOnly/);
  assert.match(set, /Path=\//);
  assert.equal(cookieValue(res.cookies, ST_COOKIE), '', 'the departure cookie is expired');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null, 'a proof never mints a session');
  assert.equal(dbSnapshot(h), before, 'a proof is never written to disk');
  assert.equal(proofFails(h).length, 0);
});

test('the linked identity with a fresh auth_time leaves a proof the same way', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { res, proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', authTime: nowS() });
  assert.equal(res.location, '/#/settings?proof=ok');
  assert.ok(proofCookie);
});

test('the linked identity with a sign-in older than the request is refused stale-sign-in', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { res, proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', authTime: nowS() - 600 });
  assert.equal(res.location, '/#/settings?proof-err=stale-sign-in');
  assert.equal(proofCookie, null);
  const fail = proofFails(h).at(-1);
  assert.equal(fail.ok, false);
  assert.equal(fail.act, 'passkey-add');
  assert.equal(fail.msg, 'stale-sign-in');
  assert.equal(fail.uid, USER.id);
});

test('the linked identity with an auth_time that is not a time is refused stale-sign-in, never taken as unreported', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { res, proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', authTime: String(nowS()) });
  assert.equal(res.location, '/#/settings?proof-err=stale-sign-in');
  assert.equal(proofCookie, null);
  assert.equal(proofFails(h).at(-1).msg, 'stale-sign-in');
});

test('another account at the same provider is refused identity-mismatch, whatever auth_time it carries', async t => {
  for (const authTime of [undefined, 'fresh', 'stale']) {
    const { provider, h, cookie } = await providerOnly(t);
    const at = authTime === 'fresh' ? nowS() : authTime === 'stale' ? nowS() - 600 : undefined;
    const { res, proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', sub: 'someone-else', authTime: at });
    assert.equal(res.location, '/#/settings?proof-err=identity-mismatch', `auth_time ${authTime}`);
    assert.equal(proofCookie, null);
    const fail = proofFails(h).at(-1);
    assert.equal(fail.msg, 'identity-mismatch', 'the identity rule is decided first, so the record names it');
    assert.equal(fail.act, 'passkey-add');
    assert.equal(fail.ok, false);
  }
});

test('the audit record of a refused proof names neither subject nor issuer', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', sub: 'someone-else' });
  const raw = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  assert.equal(raw.includes('someone-else'), false);
  assert.equal(raw.includes('subject-1'), false);
  assert.equal(raw.includes(provider.base), false);
});

test('an identity removed from the profile while the browser was away is refused identity-mismatch', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  const removed = await h.req('DELETE', '/api/account/identities', { body: await stepUp(h, key, cookie), cookie });
  assert.equal(removed.status, 200, 'the removal itself must succeed, or the case proves nothing');
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: start.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  assert.equal(res.location, '/#/settings?proof-err=identity-mismatch');
  assert.equal(cookieValue(res.cookies, PROOF_COOKIE), null);
});

test('the same proof callback replayed is refused on its state, and leaves no second proof', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: start.nonce }) });
  const first = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  assert.equal(first.location, '/#/settings?proof=ok');
  const again = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  assert.match(again.location, /state-(unknown|expired)/);
  assert.ok(!cookieValue(again.cookies, PROOF_COOKIE), 'a replay must not leave a proof');
});

test('a proof callback after sign out everywhere mid-flight answers state-unknown', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  const out = await h.req('POST', '/api/logout/all', { cookie });
  assert.equal(out.status, 200);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: start.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  assert.equal(res.location, '/#/settings?proof-err=state-unknown');
  assert.equal(cookieValue(res.cookies, PROOF_COOKIE), null);
  assert.equal(proofFails(h).at(-1).msg, 'session-changed');
});

test('a proof callback carrying another session of the same profile answers state-unknown', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  await new Promise(r => setTimeout(r, 2));
  const other = mintSession(h.secret, USER.id);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: start.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${other}`, state: start.state });
  assert.equal(res.location, '/#/settings?proof-err=state-unknown');
  assert.equal(cookieValue(res.cookies, PROOF_COOKIE), null);
});

test('a proof callback whose token fails verification answers token-invalid on Settings', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: 'a-nonce-this-attempt-never-sent' }) });
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  assert.equal(res.location, '/#/settings?proof-err=token-invalid');
  assert.equal(cookieValue(res.cookies, PROOF_COOKIE), null);
  const fail = proofFails(h).at(-1);
  assert.equal(fail.msg, 'token-invalid');
  assert.equal(fail.act, 'passkey-add');
});

test('a provider that refuses the request is never taken as a proof', async t => {
  const { h, cookie } = await providerOnly(t);
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  const start = await beginProof(h, cookie, ticket);
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state, error: 'login_required' });
  assert.equal(res.location, '/#/settings?proof-err=token-invalid');
  assert.equal(cookieValue(res.cookies, PROOF_COOKIE), null);
});

/* ---------- proveOwner: the proof spent on the change it was made for ---------- */

// Adds a passkey through the two passkey routes, confirming with whatever proof cookie and body
// a case is exercising. Answers the options response, and the verify response when options passed.
async function addPasskey(h, cookie, proofCookie, key, body = { identityProof: true }) {
  const both = proofCookie ? `${cookie}; ${proofCookie}` : cookie;
  const options = await h.req('POST', '/api/account/passkeys/options', { body, cookie: both });
  if (options.status !== 200) return { options };
  const verify = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: options.body.cid, credential: key.attestation(options.body.options.challenge), name: 'Phone' }, cookie
  });
  return { options, verify };
}

test('a provider-only profile adds a passkey with a provider proof whose token carries no auth_time', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const before = await h.req('GET', '/api/account/passkeys', { cookie });
  assert.equal(before.body.lastWayIn, true, 'the case needs a profile whose only way in is its identity');
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  const key = softAuthenticator();
  const { options, verify } = await addPasskey(h, cookie, proofCookie, key);
  assert.equal(options.status, 200);
  assert.ok(options.body.cid);
  assert.equal(verify.status, 200);
  assert.ok(verify.body.passkeys.some(p => p.id === key.id), 'the new passkey is listed');
  assert.equal(verify.body.lastWayIn, false);
  const added = h.audit().find(r => r.ev === 'auth.passkey.add');
  assert.equal(added.msg, 'identity', 'the change is recorded with the proof kind that allowed it');
});

test('a provider-only profile adds a passkey with a provider proof carrying a fresh auth_time', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add', authTime: nowS() });
  const { verify } = await addPasskey(h, cookie, proofCookie, softAuthenticator());
  assert.equal(verify.status, 200);
  assert.equal(verify.body.lastWayIn, false);
});

test('a proof made for adding a passkey does not confirm removing the identity, and is spent by the attempt', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  assert.ok(proofCookie);
  const remove = await h.req('DELETE', '/api/account/identities', { body: { identityProof: true }, cookie: `${cookie}; ${proofCookie}` });
  assert.equal(remove.status, 403);
  assert.equal(remove.body.code, 'identity-proof');
  const fail = proofFails(h).at(-1);
  assert.equal(fail.ok, false);
  assert.equal(fail.act, 'identity-remove');
  assert.equal(fail.msg, 'identity-proof-invalid');
  assert.equal(h.db().identities.length, 1, 'nothing was removed');
  const { options } = await addPasskey(h, cookie, proofCookie, softAuthenticator());
  assert.equal(options.status, 403, 'the proof was spent by the refused attempt');
  assert.equal(options.body.code, 'identity-proof');
});

test('a provider proof is one-shot', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  const first = await addPasskey(h, cookie, proofCookie, softAuthenticator());
  assert.equal(first.options.status, 200);
  const second = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${cookie}; ${proofCookie}` });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'identity-proof');
});

test('a provider proof presented under another session of the same profile is refused', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  await new Promise(r => setTimeout(r, 2));
  const other = mintSession(h.secret, USER.id);
  const res = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${other}; ${proofCookie}` });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
});

test('a provider proof presented after sign out everywhere, under the new session, is refused', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  const out = await h.req('POST', '/api/logout/all', { cookie });
  assert.equal(out.status, 200);
  const stale = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${cookie}; ${proofCookie}` });
  assert.equal(stale.status, 401, 'the session that asked is over');
  const fresh = mintSession(h.secret, USER.id, 1);
  const res = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${fresh}; ${proofCookie}` });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'identity-proof');
});

test('a provider proof whose identity was removed from the profile before it is presented is refused', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  assert.ok(proofCookie);
  const removed = await h.req('DELETE', '/api/account/identities', { body: await stepUp(h, key, cookie), cookie });
  assert.equal(removed.status, 200, 'the removal itself must succeed, or the case proves nothing');
  const { options } = await addPasskey(h, cookie, proofCookie, softAuthenticator());
  assert.equal(options.status, 403);
  assert.equal(options.body.code, 'identity-proof');
});

test('identityProof with no proof cookie, or with two different ones, is refused', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const none = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie });
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'identity-proof');
  const a = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  const b = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  assert.ok(a.proofCookie && b.proofCookie && a.proofCookie !== b.proofCookie);
  const two = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: true }, cookie: `${cookie}; ${a.proofCookie}; ${b.proofCookie}` });
  assert.equal(two.status, 403);
  assert.equal(two.body.code, 'identity-proof');
});

test('only identityProof set to true takes the provider proof; anything else is the ordinary path', async t => {
  const { provider, h, cookie } = await providerOnly(t);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'passkey-add' });
  const res = await h.req('POST', '/api/account/passkeys/options', { body: { identityProof: 'true' }, cookie: `${cookie}; ${proofCookie}` });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'passkey-required', 'a truthy string is not the flag');
  const ok = await addPasskey(h, cookie, proofCookie, softAuthenticator());
  assert.equal(ok.options.status, 200, 'the proof was not spent by a request that never asked for it');
});

test('a profile with a passkey and a linked identity removes the identity with a proof made by that identity', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [], identities: [linked(provider)] } });
  const cookie = mintSession(h.secret, USER.id);
  const { proofCookie } = await proofRoundTrip(h, provider, { cookie, act: 'identity-remove' });
  const res = await h.req('DELETE', '/api/account/identities', { body: { identityProof: true }, cookie: `${cookie}; ${proofCookie}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.identity, null);
  assert.equal((h.db().identities || []).length, 0);
  assert.equal(h.audit().find(r => r.ev === 'auth.identity.remove').msg, 'identity');
});
