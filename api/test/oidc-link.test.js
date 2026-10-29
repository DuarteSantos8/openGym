/* Linking an external identity to an existing profile: a session alone must never be
 * enough to start it -- the same bar #95 held a device-link code to ("a code alone never gives a
 * session"; here, a cookie alone never gives a new way in). The owner proves it is them on
 * Settings, that proof buys a one-shot ticket, and only a departure carrying a live ticket ever
 * reaches the provider.
 *
 * This suite proves the ticket route and the ticket-gated departure leg against a real spawned
 * server and a real in-process provider double. The return leg that attaches the identity to the
 * profile arrives with the callback's own link mode, proven alongside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProvider, startApi, mintSession, softAuthenticator, stepUp, beginFlow, completeCallback,
  linkTicket, beginLink, cookieValue, ST_COOKIE, SESSION_COOKIE
} from './oidc-harness.mjs';

const USER = { id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z' };
const dbSnapshot = h => fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');

// Mints a ticket under the given session and returns just the ticket string, for a case whose
// point is the departure leg rather than the mint itself.
async function mintTicket(h, cookie, key) {
  const proof = await stepUp(h, key, cookie);
  const res = await linkTicket(h, cookie, proof);
  return res.body.ticket;
}

// Drives the full ticket -> departure -> return round trip a browser makes for a link: proves
// ownership with the given key, mints a ticket, departs, arms the provider's next token-endpoint
// answer, then completes the callback carrying both the departure cookie and the session that
// started the attempt.
async function completeLink(h, provider, cookie, key, { sub = 'subject-1', email, email_verified } = {}) {
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: link.nonce, email, email_verified }) });
  return completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${cookie}`, state: link.state });
}

/* ---------- POST /api/account/identities/link-ticket ---------- */

test('link-ticket with no session answers 401', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [] } });
  const res = await linkTicket(h, null, {});
  assert.equal(res.status, 401);
});

test('link-ticket with no provider configured answers provider-off, before any proof is asked', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider, env: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '' },
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const res = await linkTicket(h, cookie, {});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'provider-off');
});

test('link-ticket for a profile that already has a linked identity answers profile-linked, before any proof is asked', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, {
    provider,
    db: {
      users: [USER], creds: [], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: USER.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const cookie = mintSession(h.secret, USER.id);
  const res = await linkTicket(h, cookie, {});
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'profile-linked');
});

test('link-ticket with a session alone (empty body) is refused passkey-required, and audits nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const res = await linkTicket(h, cookie, {});
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'passkey-required');
  assert.equal(h.audit().length, 0, "upstream's own convention: a session alone asked for no proof, so nothing is audited");
});

test('link-ticket with a wrong passkey assertion is refused, and audits the failed proof against identity-link', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const wrong = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, wrong, cookie);
  const res = await linkTicket(h, cookie, proof);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'passkey');
  const fail = h.audit().find(r => r.ev === 'auth.proof.fail');
  assert.ok(fail, 'the failed proof must be audited');
  assert.equal(fail.act, 'identity-link');
});

test('link-ticket with a good step-up answers a 43-character ticket', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, key, cookie);
  const res = await linkTicket(h, cookie, proof);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.ticket, 'string');
  assert.equal(res.body.ticket.length, 43, 'a base64url rendering of 32 random bytes is 43 characters');
});

test('link-ticket sent cross-site is refused by the origin check', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const proof = await stepUp(h, key, cookie);
  const res = await h.req('POST', '/api/account/identities/link-ticket', { body: proof, cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'cross-origin request refused');
});

/* ---------- GET /api/oidc/link/start: the ticket-gated departure ---------- */

test('link/start with no session answers not-signed-in, and sets no live departure cookie', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [] } });
  const link = await beginLink(h, null, 'a-ticket-nobody-minted');
  assert.equal(link.res.status, 302);
  assert.equal(link.res.location, '/#/settings?link-err=not-signed-in');
  assert.equal(cookieValue(link.res.cookies, SESSION_COOKIE), null);
  // Every browser-navigated refusal clears any departure cookie the browser might already be
  // carrying, using the same expiring Set-Cookie every other refusal answers with -- so "no
  // departure cookie" here means no addressable one, not a bare absence of the header.
  const departureCookie = cookieValue(link.res.cookies, ST_COOKIE);
  assert.ok(!departureCookie, 'a refusal reached before any flow is minted must not leave an addressable departure cookie behind');
});

test('link/start with a valid session and no ticket answers ticket-invalid, and never names the provider', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, db: { users: [USER], creds: [], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const link = await beginLink(h, cookie, null);
  assert.equal(link.res.status, 302);
  assert.equal(link.res.location, '/#/settings?link-err=ticket-invalid');
  assert.equal(cookieValue(link.res.cookies, SESSION_COOKIE), null);
  assert.equal(link.res.location.includes(provider.base), false);
});

test('link/start with a live ticket redirects to the provider with state, nonce and a PKCE challenge, and sets no session cookie', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  assert.equal(link.res.status, 302);
  const location = new URL(link.res.location, h.api);
  assert.equal(location.origin + location.pathname, provider.base + '/authorize');
  assert.ok(link.state, 'no state parameter');
  assert.ok(link.nonce, 'no nonce parameter');
  assert.ok(link.res.query.get('code_challenge'), 'no code_challenge parameter');
  assert.equal(link.res.query.get('code_challenge_method'), 'S256');
  assert.equal(cookieValue(link.res.cookies, SESSION_COOKIE), null);
});

test("the link departure's redirect_uri is byte-identical to the sign-in departure's own", async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const signIn = await h.raw('GET', '/api/oidc/start');
  const link = await beginLink(h, cookie, ticket);
  const signInUri = signIn.query.get('redirect_uri');
  const linkUri = link.res.query.get('redirect_uri');
  assert.ok(signInUri, 'no redirect_uri on the sign-in departure');
  assert.equal(linkUri, signInUri, 'one callback route serves both departures');
});

test('a link departure sets the departure cookie to the same value as the state parameter it sends', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  assert.equal(link.cookieHeader, `${ST_COOKIE}=${link.state}`);
});

test('the same ticket presented twice: the second departure answers ticket-invalid', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const first = await beginLink(h, cookie, ticket);
  assert.notEqual(first.res.location, '/#/settings?link-err=ticket-invalid', 'the first presentation must succeed, or the case proves nothing');
  const second = await beginLink(h, cookie, ticket);
  assert.equal(second.res.location, '/#/settings?link-err=ticket-invalid');
});

test('a ticket minted under one session, presented under a different session of the same profile, answers session-changed', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const mintingCookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, mintingCookie, key);
  // A distinct token for the very same account: sessionBinding hashes the presented token itself,
  // not the profile it resolves to, so a fresh session for the same user is still "another
  // session" as far as the ticket is concerned.
  await new Promise(r => setTimeout(r, 2));
  const otherCookie = mintSession(h.secret, USER.id);
  const link = await beginLink(h, otherCookie, ticket);
  assert.equal(link.res.location, '/#/settings?link-err=session-changed');
});

test('a ticket minted under one profile, presented under a session for another profile, answers session-changed', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const other = { id: 'u2', name: 'Bea', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, { provider, db: { users: [USER, other], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const otherCookie = mintSession(h.secret, other.id);
  const link = await beginLink(h, otherCookie, ticket);
  assert.equal(link.res.location, '/#/settings?link-err=session-changed');
});

test('a ticket presented under another session, another profile or no session at all is not spent, and still departs for its owner', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const other = { id: 'u2', name: 'Bea', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, { provider, db: { users: [USER, other], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  await new Promise(r => setTimeout(r, 2));
  for (const intruder of [mintSession(h.secret, USER.id), mintSession(h.secret, other.id), null]) {
    const refused = await beginLink(h, intruder, ticket);
    assert.equal(refused.state, null, 'nothing may depart for the provider');
  }
  const link = await beginLink(h, cookie, ticket);
  assert.ok(link.state, 'the owner\'s ticket must survive every other presentation');
});

test('link/start with the provider unreachable answers provider-unreachable on Settings', async t => {
  const key = softAuthenticator();
  // No provider is started at all: the issuer address is one nothing listens on, the same shape
  // a provider going down entirely would leave a running instance in.
  const dead = { base: 'http://127.0.0.1:1', clientId: 'opengym-test-client' };
  const h = await startApi(t, { provider: dead, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  assert.equal(link.res.status, 302);
  assert.equal(link.res.location, '/#/settings?link-err=provider-unreachable');
  assert.equal(cookieValue(link.res.cookies, SESSION_COOKIE), null);
});

/* ---------- GET /api/oidc/callback: the link branch's successful return ---------- */

test('a profile holding a passkey and no identity links successfully to #/settings?link=ok, with no session cookie', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const res = await completeLink(h, provider, cookie, key);
  assert.equal(res.location, '/#/settings?link=ok');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  assert.equal(h.db().identities.length, 1);
  assert.equal(h.db().identities[0].userId, USER.id);
});

test('the linked row carries the address the token vouched for, and a link timestamp', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const email = 'linked-address@example.com';
  await completeLink(h, provider, cookie, key, { email, email_verified: true });
  assert.equal(h.db().identities[0].email, email);
  assert.ok(h.db().identities[0].linkedAt);
});

test('a token carrying an address the provider did not vouch for links with the stored address field null', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  // present but not marked vouched-for
  const res = await completeLink(h, provider, cookie, key, { email: 'unvouched@example.com' });
  assert.equal(res.location, '/#/settings?link=ok', 'the link still succeeds');
  assert.equal(h.db().identities[0].email, null);
});

test('a profile links its identity, is signed out, signs in through the provider, and lands in the same profile with its data untouched', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] },
    states: { [USER.id]: { marker: 'seeded-profile-data' } }
  });
  const stateBefore = fs.readFileSync(path.join(h.dataDir, `state-${USER.id}.json`), 'utf8');
  const cookie = mintSession(h.secret, USER.id);
  const linkRes = await completeLink(h, provider, cookie, key);
  assert.equal(linkRes.location, '/#/settings?link=ok', 'the link itself must succeed, or the case proves nothing');

  // A browser signed out entirely -- no session cookie anywhere -- signs in through the provider
  // using the identity just linked.
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: flow.nonce }) });
  const signInRes = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state });
  assert.equal(signInRes.location, '/', 'a known identity carries no fragment at all');
  const sessionCookie = cookieValue(signInRes.cookies, SESSION_COOKIE);
  assert.ok(sessionCookie, 'no session cookie was set by the sign-in');

  const me = await h.req('GET', '/api/me', { cookie: `${SESSION_COOKIE}=${sessionCookie}` });
  assert.equal(me.body.user.id, USER.id, 'the sign-in must land in the very profile that linked the identity');
  assert.equal(h.db().users.length, 1, 'linking an identity must never mint a second profile');
  assert.equal(fs.readFileSync(path.join(h.dataDir, `state-${USER.id}.json`), 'utf8'), stateBefore);
});

test('linking the same identity from two racing attempts leaves exactly one row, and the second reads back as already linked', async t => {
  // Once the first attempt resolves, the ticket route's own upfront profile-linked check refuses
  // any further ticket for this profile -- so both tickets have to be minted and depart before
  // either one resolves, the same race the profile-linked case above exercises, this time with
  // both attempts naming the very same identity.
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);

  const ticketA = await mintTicket(h, cookie, key);
  const linkA = await beginLink(h, cookie, ticketA);
  const ticketB = await mintTicket(h, cookie, key);
  const linkB = await beginLink(h, cookie, ticketB);

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: linkA.nonce }) });
  const resA = await completeCallback(h, { cookieHeader: `${linkA.cookieHeader}; ${cookie}`, state: linkA.state });
  assert.equal(resA.location, '/#/settings?link=ok', 'the first attempt to resolve must succeed, or the case proves nothing');

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: linkB.nonce }) });
  const resB = await completeCallback(h, { cookieHeader: `${linkB.cookieHeader}; ${cookie}`, state: linkB.state });
  assert.equal(resB.location, '/#/settings?link=ok', 'the same owner re-linking the identity they already hold must not be refused');

  assert.equal(h.db().identities.length, 1, 'a repeated link must not double-write');
  const ok = h.audit().filter(r => r.ev === 'auth.identity.link.ok');
  assert.equal(ok.length, 2);
  assert.equal(ok[1].msg, 'already');
});

test('the audit log after a successful link holds the success event and never the subject, the address or the issuer host', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const email = 'link-success-address@example.com';
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  await completeLink(h, provider, cookie, key, { email, email_verified: true });
  const raw = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  const ok = h.audit().find(r => r.ev === 'auth.identity.link.ok' && !r.msg);
  assert.ok(ok, 'the success event must be recorded');
  assert.equal(raw.includes('subject-1'), false, 'the subject must never reach the log');
  assert.equal(raw.includes(email), false, 'the address must never reach the log');
  assert.equal(raw.includes(provider.base), false, 'the issuer host must never reach the log');
});

/* ---------- GET /api/oidc/callback: the link branch's refusals ---------- */

test('a link callback with the session cookie dropped mid-flight answers session-changed, and leaves db.json unchanged', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  const before = dbSnapshot(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: link.nonce }) });
  // The browser lost its session cookie between the departure and the return -- only the
  // departure cookie rides back.
  const res = await completeCallback(h, { cookieHeader: link.cookieHeader, state: link.state });
  assert.equal(res.location, '/#/settings?link-err=session-changed');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  assert.equal(dbSnapshot(h), before, 'a refused link must write nothing');
});

test('a link callback carrying a session cookie for a different profile answers session-changed, and neither profile gains a record', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const other = { id: 'u2', name: 'Bea', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, { provider, db: { users: [USER, other], creds: [key.row(USER.id)], subs: [], invites: [], identities: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  const otherCookie = mintSession(h.secret, other.id);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: link.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${otherCookie}`, state: link.state });
  assert.equal(res.location, '/#/settings?link-err=session-changed');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  assert.equal((h.db().identities || []).length, 0, 'neither profile gains a record from a session switched mid-flight');
});

test('a link callback carrying a newer session of the same profile answers session-changed, and writes nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  const before = dbSnapshot(h);
  // Signed out and back in (or another session of the same account) between departure and return.
  await new Promise(r => setTimeout(r, 2));
  const newer = mintSession(h.secret, USER.id);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: link.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${newer}`, state: link.state });
  assert.equal(res.location, '/#/settings?link-err=session-changed');
  assert.equal(dbSnapshot(h), before, 'a refused link must write nothing');
});

test('a link callback delivered after the departing profile signed out everywhere mid-flight answers session-changed', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  const logoutAll = await h.req('POST', '/api/logout/all', { cookie });
  assert.equal(logoutAll.status, 200, 'the sign-out-everywhere itself must succeed, or the case proves nothing');
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: link.nonce }) });
  const res = await completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${cookie}`, state: link.state });
  assert.equal(res.location, '/#/settings?link-err=session-changed',
    'the pinned session version no longer resolves, which is what a sign-out-everywhere mid-flight looks like from this route');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
});

test('an identity already linked to another profile is refused with identity-collision, and the acting profile writes nothing', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const holder = { id: 'holder-1', name: 'Holder', created: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, {
    provider,
    db: {
      users: [USER, holder], creds: [key.row(USER.id)], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: holder.id, email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const cookie = mintSession(h.secret, USER.id);
  const res = await completeLink(h, provider, cookie, key);
  assert.equal(res.location, '/#/settings?link-err=identity-collision');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
  const db = h.db();
  assert.equal(db.identities.length, 1, 'the identity must still point only at the profile that already held it');
  assert.equal(db.creds.filter(c => c.userId === USER.id).length, 1, "the acting profile keeps exactly the credentials it had");
});

test('the collision refusal is recorded with both profile ids, and the log names neither the subject, the address nor the issuer host', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const holder = { id: 'holder-2', name: 'Holder Two', created: '2026-01-01T00:00:00.000Z' };
  const email = 'holder-address@example.com';
  const h = await startApi(t, {
    provider,
    db: {
      users: [USER, holder], creds: [key.row(USER.id)], subs: [], invites: [],
      identities: [{ iss: provider.base, sub: 'subject-1', userId: holder.id, email, linkedAt: '2026-01-01T00:00:00.000Z' }]
    }
  });
  const cookie = mintSession(h.secret, USER.id);
  await completeLink(h, provider, cookie, key, { email, email_verified: true });
  const raw = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  const fail = h.audit().find(r => r.ev === 'auth.identity.link.fail' && r.msg === 'identity-collision');
  assert.ok(fail, 'the refusal must be recorded');
  assert.equal(fail.uid, USER.id, 'the acting profile must be named');
  assert.equal(fail.tgt, holder.id, 'the other profile must be named too');
  assert.equal(raw.includes('subject-1'), false, 'the subject must never reach the log');
  assert.equal(raw.includes(email), false, 'the address must never reach the log');
  assert.equal(raw.includes(provider.base), false, 'the issuer host must never reach the log');
});

test('a second concurrent link for the same profile is refused profile-linked by the store\'s own defensive check', async t => {
  // Both tickets are minted and depart while the profile still holds nothing -- a race the ticket
  // route's own upfront profile-linked check cannot see, since neither attempt has resolved yet.
  // addIdentity's own defensive check is the safety net that catches it at the return leg.
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);

  const ticketA = await mintTicket(h, cookie, key);
  const linkA = await beginLink(h, cookie, ticketA);
  const ticketB = await mintTicket(h, cookie, key);
  const linkB = await beginLink(h, cookie, ticketB);

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-2', nonce: linkB.nonce }) });
  const resB = await completeCallback(h, { cookieHeader: `${linkB.cookieHeader}; ${cookie}`, state: linkB.state });
  assert.equal(resB.location, '/#/settings?link=ok', 'the first attempt to resolve must succeed, or the race proves nothing');

  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: linkA.nonce }) });
  const resA = await completeCallback(h, { cookieHeader: `${linkA.cookieHeader}; ${cookie}`, state: linkA.state });
  assert.equal(resA.location, '/#/settings?link-err=profile-linked');
  assert.equal(h.db().identities.length, 1, 'the profile keeps the identity that won the race, and gains no second row');
});

test('a link whose identity token fails verification answers token-invalid on Settings, not the app root', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub: 'subject-1', nonce: 'a-nonce-this-link-attempt-never-sent' }) });
  const res = await completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${cookie}`, state: link.state });
  assert.equal(res.location, '/#/settings?link-err=token-invalid',
    'the attempt was already resolved to a link when the token was checked');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
});

test('a link departure followed by a callback whose state does not match the cookie answers state-unknown on Settings, where the signed-in app reads it', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, { provider, db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] } });
  const cookie = mintSession(h.secret, USER.id);
  const ticket = await mintTicket(h, cookie, key);
  const link = await beginLink(h, cookie, ticket);
  const res = await completeCallback(h, { cookieHeader: `${link.cookieHeader}; ${cookie}`, state: 'a-state-the-cookie-does-not-name' });
  assert.equal(res.location, '/#/settings?oidc-err=state-unknown',
    'nothing has resolved the attempt to a mode, but the browser is signed in, so it was not signing in');
  assert.equal(cookieValue(res.cookies, SESSION_COOKIE), null);
});

/* ---------- subpath deployment ---------- */

test('under a subpath deployment, the link return starts with the app path', async t => {
  const provider = await startProvider(t);
  const key = softAuthenticator();
  const h = await startApi(t, {
    provider, env: { ORIGIN: 'http://localhost:8080', OIDC_REDIRECT_URI: 'http://localhost:8080/gym/api/oidc/callback' },
    db: { users: [USER], creds: [key.row(USER.id)], subs: [], invites: [] }
  });
  const cookie = mintSession(h.secret, USER.id);
  const res = await completeLink(h, provider, cookie, key);
  assert.equal(res.location, '/gym/#/settings?link=ok');
});
