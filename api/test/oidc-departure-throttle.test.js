/* The departures to the provider are GETs a browser navigates to, and a GET passes the origin
 * check, so any page on the web can make its visitor's browser send one - an <img> is enough. None
 * of them may therefore spend the per-address budget the password and device-link routes share:
 * that would let any page pause password sign-in and device-link redemption for its visitors, and
 * for everybody behind a proxy that shows the API one address. The departures count in a window of
 * their own, only on an instance with a provider configured, and only for top-level navigations.
 *
 * Everything here runs against a real spawned server and a real in-process provider double.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startProvider, startApi, withPassword, mintSession, proofTicket, beginProof, cookieValue, ST_COOKIE
} from './oidc-harness.mjs';

const PW = 'a long enough passphrase';
const ADDR = '203.0.113.50';
const seed = async (extra = {}) => ({
  users: [{ id: 'u1', name: 'Ana', created: '2026-01-01T00:00:00.000Z', pw: await withPassword(PW) }],
  creds: [], subs: [], invites: [], ...extra
});

// What a page on another site makes a browser send for <img src=".../api/oidc/start">.
const crossSiteImage = { 'x-forwarded-for': ADDR, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' };
// What a browser sends when the app itself navigates to a departure.
const navigation = { 'x-forwarded-for': ADDR, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' };

// Password sign-in with the right password and a device-link redemption from the same address,
// neither of which may be paused by anything a departure did.
async function upstreamBudgetUntouched(h) {
  const login = await h.req('POST', '/api/login/password', { body: { name: 'Ana', password: PW }, headers: { 'x-forwarded-for': ADDR } });
  assert.equal(login.status, 200, 'password sign-in must not be paused by requests to the OIDC routes');
  const redeem = await h.req('POST', '/api/device-link/options', { body: { code: 'ABCD-EFGH-JKLM' }, headers: { 'x-forwarded-for': ADDR } });
  assert.notEqual(redeem.status, 429, 'device-link redemption must not be paused by requests to the OIDC routes');
}

test('a hundred cross-site image requests to the start route and the naming screen leave password sign-in and device-link redemption unthrottled', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: await seed() });
  for (let i = 0; i < 100; i++) {
    const start = await h.raw('GET', '/api/oidc/start', { headers: crossSiteImage });
    assert.equal(start.status, 403, 'a subresource request is not a departure');
    assert.equal(start.location, null);
    assert.deepEqual(start.cookies, [], 'a refused subresource request sets and clears no cookie');
    const pending = await h.req('GET', '/api/oidc/pending', { headers: crossSiteImage });
    assert.equal(pending.status, 401, 'the naming screen reads nothing without its cookie, and is not throttled');
  }
  await upstreamBudgetUntouched(h);
  // Nor did the refused requests count against the departures' own window.
  const depart = await h.raw('GET', '/api/oidc/start', { headers: navigation });
  assert.equal(depart.status, 302);
  assert.equal(new URL(depart.location).origin + new URL(depart.location).pathname, provider.base + '/authorize');
});

test('departures past their own window answer locked, and still leave password sign-in and device-link redemption unthrottled', async t => {
  const provider = await startProvider(t);
  const h = await startApi(t, { provider, env: { PASSWORD_LOGIN: '1' }, db: await seed() });
  for (let i = 0; i < 60; i++) {
    const ok = await h.raw('GET', '/api/oidc/start', { headers: navigation });
    assert.ok(ok.query.get('state'), 'every navigation inside the window departs');
  }
  const locked = await h.raw('GET', '/api/oidc/start', { headers: navigation });
  assert.equal(locked.location, '/#err=locked');
  for (let i = 0; i < 40; i++) await h.raw('GET', '/api/oidc/start', { headers: navigation });
  await upstreamBudgetUntouched(h);
  const pending = await h.req('GET', '/api/oidc/pending', { headers: { 'x-forwarded-for': ADDR } });
  assert.equal(pending.status, 401, 'the naming screen is not paused by the departures either');
});

test('an instance without a provider configured counts nothing, however many requests reach the OIDC routes', async t => {
  const h = await startApi(t, { provider: { base: '', clientId: '' }, env: { PASSWORD_LOGIN: '1' }, db: await seed() });
  const config = await h.req('GET', '/api/config');
  assert.equal(config.body.oidc, undefined, 'the case needs an instance with no provider at all');
  for (let i = 0; i < 100; i++) {
    const start = await h.raw('GET', '/api/oidc/start', { headers: navigation });
    assert.equal(start.location, '/#err=provider-misconfigured', 'nothing is counted, so nothing is ever locked');
    await h.raw('GET', '/api/oidc/start', { headers: crossSiteImage });
    await h.req('GET', '/api/oidc/pending', { headers: { 'x-forwarded-for': ADDR } });
  }
  await upstreamBudgetUntouched(h);
});

test('a subresource request carrying a live proof ticket spends nothing, and the owner\'s navigation still departs with it', async t => {
  const provider = await startProvider(t);
  const linked = { iss: provider.base, sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
  const h = await startApi(t, { provider, db: await seed({ identities: [linked] }) });
  const cookie = mintSession(h.secret, 'u1');
  const ticket = (await proofTicket(h, cookie, 'passkey-add')).body.ticket;
  assert.ok(ticket, 'the ticket must exist, or the case proves nothing');
  const before = h.audit().length;

  const asImage = await h.raw('GET', `/api/oidc/proof/start?ticket=${encodeURIComponent(ticket)}`, { cookie, headers: { 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Mode': 'no-cors' } });
  assert.equal(asImage.status, 403);
  assert.equal(cookieValue(asImage.cookies, ST_COOKIE), null);
  const asFetch = await h.raw('GET', `/api/oidc/proof/start?ticket=${encodeURIComponent(ticket)}`, { cookie, headers: { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors' } });
  assert.equal(asFetch.status, 403);
  const linkAsImage = await h.raw('GET', '/api/oidc/link/start?ticket=x', { cookie, headers: { 'Sec-Fetch-Dest': 'image' } });
  assert.equal(linkAsImage.status, 403);
  assert.equal(h.audit().length, before, 'a refused subresource request records nothing');

  const proof = await beginProof(h, cookie, ticket);
  assert.ok(proof.state, 'the ticket must still be live for its owner\'s navigation');
});
