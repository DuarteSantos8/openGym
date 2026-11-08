/* "Sign in with OpenRouter": the PKCE pair, the addresses, the callback checks and the exchange. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makePkce, authUrl, readCallback, pastedCode, exchangeCode, OPENROUTER_KEYS } from '../coach/core/openrouter-oauth.js';

test('the verifier is a fresh 43-character base64url string and the challenge is its SHA-256', async () => {
  const a = await makePkce();
  const b = await makePkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
  const expect = createHash('sha256').update(a.verifier).digest('base64url');
  assert.equal(a.challenge, expect);
});

test('the auth address carries the callback, S256 and the state; headless mode has neither callback nor state', () => {
  const u = new URL(authUrl({ callbackUrl: 'https://gym.example/', challenge: 'C', state: 'S' }));
  assert.equal(u.origin + u.pathname, 'https://openrouter.ai/auth');
  assert.equal(u.searchParams.get('callback_url'), 'https://gym.example/');
  assert.equal(u.searchParams.get('code_challenge'), 'C');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 'S');
  const h = new URL(authUrl({ challenge: 'C', state: 'S' }));
  assert.equal(h.searchParams.get('callback_url'), null);
  assert.equal(h.searchParams.get('state'), null);
  assert.equal(h.searchParams.get('code_challenge'), 'C');
});

test('a callback is ours only with the state we sent; a denial and a missing code are named', () => {
  assert.deepEqual(readCallback('https://gym.example/?code=abc&state=S', 'S'), { code: 'abc' });
  assert.deepEqual(readCallback('https://gym.example/?code=abc&state=X', 'S'), { error: 'state' });
  assert.deepEqual(readCallback('https://gym.example/?error=access_denied', 'S'), { error: 'denied' });
  assert.deepEqual(readCallback('https://gym.example/', 'S'), { error: 'nocode' });
  assert.deepEqual(readCallback('not a url', 'S'), { error: 'nocode' });
});

test('a pasted code is taken bare or out of a whole address, and junk is not', () => {
  assert.equal(pastedCode('  abcDEF123456  '), 'abcDEF123456');
  assert.equal(pastedCode('opengym://openrouter?code=zz9988776655'), 'zz9988776655');
  assert.equal(pastedCode('two words'), null);
  assert.equal(pastedCode(''), null);
});

test('the exchange posts code, verifier and method, and reads the key; a 403 says start again', async () => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '{"key":"sk-or-v1-abc"}' }; };
  const r = await exchangeCode({ code: 'c1', verifier: 'v1', fetch: f });
  assert.deepEqual(r, { ok: true, key: 'sk-or-v1-abc' });
  assert.equal(calls[0].url, OPENROUTER_KEYS);
  assert.deepEqual(calls[0].body, { code: 'c1', code_verifier: 'v1', code_challenge_method: 'S256' });
  const bad = await exchangeCode({ code: 'c', verifier: 'v', fetch: async () => ({ ok: false, status: 403, text: async () => '{"error":{"message":"Invalid code"}}' }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /expired|refused/);
  const down = await exchangeCode({ code: 'c', verifier: 'v', fetch: async () => { throw new Error('offline'); } });
  assert.match(down.error, /could not reach openrouter\.ai/);
});
