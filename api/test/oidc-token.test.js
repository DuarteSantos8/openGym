/* Two failures this suite exists to prevent, neither of which a click-through would ever find.
 *
 * The first is a token exchange that treats a coherent provider refusal the same as a broken or
 * unreachable one - conflating those tells the person signing in "try again" when the real
 * problem needs an operator, or tells the operator to investigate a network that was never the
 * issue. The second is a message, on either side of that split, that repeats the authorization
 * code or the client secret back - a credential in an error message is a credential in every log
 * line and every screen that repeats the error back.
 *
 * Everything here is offline. Every request goes through the injected fake, and the last case
 * asserts that none escaped to the real network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* Any request that escapes the injected fake lands here instead of on the network. */
const escaped = [];
globalThis.fetch = async url => { escaped.push(String(url)); throw new Error('this suite must never reach the network'); };

const { tokenRequestBody, exchangeCode } = await import('../oidc/token.js');

const TOKEN_ENDPOINT = 'https://id.example.com/token';
const SECRET_FIXTURE = 'super-secret-value-never-repeated';
const CODE_FIXTURE = 'auth-code-never-repeated';

/** A fetch that records what it was asked and answers from a script, by call number. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, signal: init.signal, redirect: init.redirect, method: init.method, body: init.body });
    const a = typeof answers === 'function' ? answers(calls.length, String(url), init) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}
const ok = body => ({ status: 200, body });
const err = (status, body) => ({ status, body });

async function rejection(p) {
  try { await p; } catch (e) { return e; }
  assert.fail('expected a refusal, got a value');
}

const baseArgs = (extra = {}) => ({
  tokenEndpoint: TOKEN_ENDPOINT,
  code: CODE_FIXTURE,
  redirectUri: 'https://gym.example.com/api/oidc/callback',
  clientId: 'client-1',
  clientSecret: null,
  verifier: 'a-pkce-verifier',
  ...extra
});

/* ---------- tokenRequestBody ---------- */

test('tokenRequestBody: a public client (no secret) omits client_secret entirely', () => {
  const body = tokenRequestBody({ code: 'c', redirectUri: 'r', clientId: 'cid', clientSecret: null, verifier: 'v' });
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'c');
  assert.equal(body.get('redirect_uri'), 'r');
  assert.equal(body.get('client_id'), 'cid');
  assert.equal(body.get('code_verifier'), 'v');
  assert.equal(body.has('client_secret'), false);
});

test('tokenRequestBody: a confidential client adds client_secret and changes nothing else', () => {
  const withSecret = tokenRequestBody({ code: 'c', redirectUri: 'r', clientId: 'cid', clientSecret: 's3cret', verifier: 'v' });
  assert.equal(withSecret.get('client_secret'), 's3cret');
  assert.equal(withSecret.get('grant_type'), 'authorization_code');
  assert.equal(withSecret.get('code'), 'c');
  assert.equal(withSecret.get('redirect_uri'), 'r');
  assert.equal(withSecret.get('client_id'), 'cid');
  assert.equal(withSecret.get('code_verifier'), 'v');
});

test('tokenRequestBody: an empty-string secret leaves the field absent, same as null', () => {
  const body = tokenRequestBody({ code: 'c', redirectUri: 'r', clientId: 'cid', clientSecret: '', verifier: 'v' });
  assert.equal(body.has('client_secret'), false);
});

/* ---------- exchangeCode: request shape ---------- */

test('exchangeCode: posts once, form-urlencoded, with an abort signal, no redirect following', async () => {
  const f = fakeFetch([ok({ id_token: 'jwt-1' })]);
  const r = await exchangeCode({ ...baseArgs(), fetch: f });
  assert.equal(r.idToken, 'jwt-1');
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  assert.equal(c.url, TOKEN_ENDPOINT);
  assert.equal(c.method, 'POST');
  assert.equal(c.redirect, 'manual');
  assert.equal(c.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.ok(c.signal, 'an abort signal is attached');
  assert.ok(c.body.includes('code=' + CODE_FIXTURE));
});

test('exchangeCode: a 200 response with a string id_token resolves to { idToken }', async () => {
  const f = fakeFetch([ok({ id_token: 'jwt-xyz' })]);
  const r = await exchangeCode({ ...baseArgs(), fetch: f });
  assert.deepEqual(r, { idToken: 'jwt-xyz' });
});

/* ---------- exchangeCode: provider-unreachable ---------- */

test('exchangeCode: a rejected fetch (network error/timeout) throws provider-unreachable naming the endpoint', async () => {
  const f = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
  assert.ok(e.message.includes(TOKEN_ENDPOINT));
});

test('exchangeCode: a 500 with no OAuth error body throws provider-unreachable', async () => {
  const f = fakeFetch([err(500, { unrelated: 'field' })]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
});

test('exchangeCode: a body that is not JSON throws provider-unreachable', async () => {
  const f = fakeFetch([{ status: 200, body: 'not json at all' }]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
});

test('exchangeCode: a body of literal null throws provider-unreachable', async () => {
  const f = fakeFetch([{ status: 200, body: 'null' }]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
});

test('exchangeCode: a body that is a JSON array throws provider-unreachable', async () => {
  const f = fakeFetch([{ status: 200, body: '[1,2,3]' }]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
});

test('exchangeCode: a body larger than the bounded reader accepts throws provider-unreachable', async () => {
  const big = 'x'.repeat(300000);
  const f = fakeFetch([{ status: 200, body: JSON.stringify({ id_token: big }) }]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'provider-unreachable');
});

/* ---------- exchangeCode: token-invalid ---------- */

test('exchangeCode: a 400 with an OAuth error body throws token-invalid naming the returned error code', async () => {
  const f = fakeFetch([err(400, { error: 'invalid_grant', error_description: 'should never appear in the message' })]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'token-invalid');
  assert.ok(e.message.includes('invalid_grant'));
  assert.ok(!e.message.includes('should never appear in the message'), 'the provider-controlled error_description is never interpolated');
});

test('exchangeCode: a 200 body with no id_token throws token-invalid', async () => {
  const f = fakeFetch([ok({ access_token: 'a', token_type: 'Bearer' })]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'token-invalid');
});

test('exchangeCode: a 200 body whose id_token is not a string throws token-invalid', async () => {
  const f = fakeFetch([ok({ id_token: 12345 })]);
  const e = await rejection(exchangeCode({ ...baseArgs(), fetch: f }));
  assert.equal(e.code, 'token-invalid');
});

/* ---------- credential leakage ---------- */

test('exchangeCode: no thrown message contains the client secret or the authorization code, across every failure class', async () => {
  const cases = [
    fakeFetch(() => { throw new Error('boom'); }),
    fakeFetch([err(500, {})]),
    fakeFetch([{ status: 200, body: 'not json' }]),
    fakeFetch([err(400, { error: 'invalid_grant' })]),
    fakeFetch([ok({})])
  ];
  for (const f of cases) {
    const e = await rejection(exchangeCode({ ...baseArgs({ clientSecret: SECRET_FIXTURE }), fetch: f }));
    assert.ok(!e.message.includes(SECRET_FIXTURE), 'the client secret never appears in an error message');
    assert.ok(!e.message.includes(CODE_FIXTURE), 'the authorization code never appears in an error message');
  }
});

test('no request escaped the injected fake to the real network', () => {
  assert.deepEqual(escaped, []);
});
