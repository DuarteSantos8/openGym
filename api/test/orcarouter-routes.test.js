/* The OrcaRouter connect flow, driven end to end through the real admin routes and a local fake
 * auth server.
 *
 * This is the test the campaign's own review asks for and the reason it asks for it: the hash
 * helper being correct is not the feature. What has to hold is the whole path — the route mints an
 * attempt, the URL a browser would be sent to is the one the server can redeem, the exchange
 * carries the verifier that matches the challenge that URL carried, the key lands in the existing
 * encrypted store, and every way the flow can fail leaves the lock released and nothing saved.
 *
 * So the "auth server" here is a real HTTP listener on loopback speaking the documented exchange
 * shape, wired in through ORCA_AUTH_BASE_URL — the same override a self-hosted deployment would
 * use — and the flow runs through coachRoutes(), not through the helpers underneath it.
 *
 * A note on what is deliberately NOT faked: the consent screen. Approving in a browser is a
 * person's decision and this test does not pretend to make it. It plays the part of the browser
 * up to the point where a code exists, then asserts on what the server does with one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData } from './helpers.mjs';

const dataDir = tempData();

const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');
const oauth = await import('../coach/core/oauth.js');
const { authBase } = await import('../coach/core/origins.js');

const AUTH_ORIGIN = 'http://127.0.0.1:';   // port filled in once the fake server is listening

/**
 * A fake auth origin. It implements the one endpoint the client calls — POST /api/v1/auth/keys —
 * and records what it was sent so the test can assert on the body rather than on the client's own
 * belief about it. `answer` decides what it returns.
 */
async function fakeAuthServer(answer = { key: 'sk-orca-minted-from-consent', user_id: 'u-42', scope: 'api' }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      if (req.method !== 'POST' || req.url !== '/api/v1/auth/keys') { res.statusCode = 404; return res.end('{}'); }
      const a = typeof answer === 'function' ? answer(seen.length) : answer;
      res.setHeader('content-type', 'application/json');
      res.statusCode = a.status || 200;
      res.end(JSON.stringify(a.body || a));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = AUTH_ORIGIN + server.address().port;
  // The override every call reads per invocation, so no module reload is needed. This is also the
  // property a self-hosted deployment depends on.
  process.env.ORCA_AUTH_BASE_URL = origin;
  return { origin, seen, close: () => new Promise(r => server.close(r)) };
}

function harness() {
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'admin-1', admin: true }),
    requireAdmin: () => true
  });
  return async (key, body) => { const res = {}; await routes[key]({ body }, res); return res; };
}

const fresh = (patch = {}) => {
  cfg.reset();
  cfg.save({ enabled: true, provider: 'orcarouter', auth: {}, models: {}, providerOptions: {}, boundUid: {}, ...patch });
  oauth.registry.clear();
};

test('connect start mints an attempt, and the URL is the one this server can redeem', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const r = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.scope, 'api');
    assert.equal(r.body.appName, 'openGym');

    const u = new URL(r.body.url);
    assert.equal(u.origin, srv.origin, 'the URL follows the configured auth origin');
    assert.equal(u.pathname, '/auth', 'authorize is fixed at /auth');
    assert.equal(u.searchParams.get('callback_url'), 'oob');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('scope'), 'api');
    assert.ok(u.searchParams.get('state'));
    assert.ok(u.searchParams.get('code_challenge'));

    // The pending attempt the server will redeem is the one the URL describes.
    const pending = oauth.registry.peek();
    assert.equal(pending.generation, r.body.generation);
    assert.equal(pending.state, u.searchParams.get('state'));
    assert.equal(pending.challenge, u.searchParams.get('code_challenge'));
    assert.equal(pending.verifier, undefined, 'the verifier is not in the view handed to the browser');
    assert.ok(!r.body.url.includes(oauth.registry.verifierFor(r.body.generation)), 'and not in the URL');
  } finally { await srv.close(); }
});

test('a start refuses a scope the consent endpoint would refuse anyway', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const r = await call('POST /api/admin/coach/connect/orcarouter/start', { scope: 'connector' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /api/);
  } finally { await srv.close(); }
});

test('complete exchanges the verifier that matches the challenge the URL carried, and stores the key encrypted', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    const url = new URL(started.body.url);
    const challenge = url.searchParams.get('code_challenge');
    const generation = started.body.generation;

    const r = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation, code: 'code-shown-on-consent' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.via, 'pkce');
    assert.equal(r.body.account, 'u-42');

    // What actually went on the wire.
    assert.equal(srv.seen.length, 1);
    const sent = srv.seen[0];
    assert.equal(sent.url, '/api/v1/auth/keys', 'the auth path, not the relay path');
    assert.equal(sent.method, 'POST');
    assert.equal(sent.body.code, 'code-shown-on-consent');
    assert.equal(sent.body.code_challenge_method, 'S256');
    assert.equal(oauth.challengeFor(sent.body.code_verifier), challenge, 'the verifier hashes to the challenge the authorize URL carried');

    // The key is in the existing encrypted store and readable through the existing path.
    const rec = cfg.authFor(cfg.load(), 'orcarouter');
    assert.ok(rec && rec.data);
    assert.equal(rec.type, 'apikey');
    assert.equal(rec.via, 'pkce');
    assert.ok(rec.connectedAt);
    assert.equal(JSON.parse(JSON.stringify(rec.data)).includes?.('sk-orca') ?? false, false, 'the stored blob is ciphertext');
    assert.deepEqual(cfg.decrypt(rec.data), { token: 'sk-orca-minted-from-consent' });

    // Nothing in the response body is the key.
    assert.ok(!JSON.stringify(r.body).includes('sk-orca'), 'the key is never returned to the browser');

    // The attempt is spent: the lock is released and the code cannot be redeemed twice.
    assert.equal(oauth.registry.isPending(), false);
    const again = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation, code: 'code-shown-on-consent' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'no-attempt');
    assert.equal(srv.seen.length, 1, 'a second exchange was never even attempted');
  } finally { await srv.close(); }
});

test('the stored key reaches the provider transport through the same env var a pasted one does', async () => {
  const srv = await fakeAuthServer({ key: 'sk-orca-from-pkce-0001', user_id: 'u-7', scope: 'api' });
  try {
    fresh();
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: started.body.generation, code: 'c' });

    // The job environment is built from the stored credential, exactly as for a pasted key.
    const cred = cfg.credentialFor(cfg.boundUidFor(cfg.load()));
    assert.equal(cred.ok, true);
    const env = cfg.jobEnv('/tmp', cred);
    assert.equal(env.ORCAROUTER_API_KEY, 'sk-orca-from-pkce-0001');

    // And the adapter uses it against the inference origin, not the auth one.
    const adapter = (await import('../coach/adapters/index.js')).adapterFor('orcarouter');
    const calls = [];
    const fake = async (u, init) => {
      calls.push({ u, init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"coach_contract":1,"nochange":true,"reading":"ok"}' }, finish_reason: 'stop' }] }) };
    };
    const out = await adapter.invoke({ cfg: cfg.load(), prompt: 'P', env, model: 'vendor/model-x', fetch: fake });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(calls[0].u, 'https://api.orcarouter.ai/v1/chat/completions');
    assert.equal(calls[0].init.headers.authorization, 'Bearer sk-orca-from-pkce-0001');
    assert.ok(!calls[0].u.includes('www.orcarouter.ai'), 'inference never goes to the auth origin');
  } finally { await srv.close(); }
});

test('a pasted API key and a PKCE key land in the same store, and the transport cannot tell them apart', async () => {
  fresh();
  const call = harness();
  const pasted = await call('POST /api/admin/coach/connect', { provider: 'orcarouter', type: 'apikey', token: 'sk-orca-pasted-0001' });
  assert.equal(pasted.status, 200, JSON.stringify(pasted.body));
  const pkceRec = { type: 'apikey', account: 'u-1', data: cfg.encrypt({ token: 'sk-orca-pkce-0001' }), connectedAt: new Date().toISOString(), via: 'pkce' };
  cfg.saveAuth('orcarouter', pkceRec);

  const adapter = (await import('../coach/adapters/index.js')).adapterFor('orcarouter');
  const seen = [];
  const fake = async (u, init) => { seen.push(init.headers.authorization); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }) }; };
  for (const token of ['sk-orca-pasted-0001', 'sk-orca-pkce-0001']) {
    const r = await adapter.invoke({ cfg: cfg.load(), prompt: 'P', env: { ORCAROUTER_API_KEY: token }, model: 'm', fetch: fake });
    assert.equal(r.code, 0);
  }
  assert.deepEqual(seen, ['Bearer sk-orca-pasted-0001', 'Bearer sk-orca-pkce-0001']);
});

test('a denied authorization is terminal: a clear reason, nothing stored, and the lock released', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    await call('POST /api/admin/coach/connect/orcarouter/start', {});
    const r = await call('POST /api/admin/coach/connect/orcarouter/denied', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.reason, 'denied');
    assert.ok(r.body.message);
    assert.equal(oauth.registry.isPending(), false, 'a denial must not leave the card spinning');
    assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null, 'nothing was saved');
    assert.equal(srv.seen.length, 0, 'nothing was exchanged');
  } finally { await srv.close(); }
});

test('cancel releases the lock, and a completion after it is refused rather than redeemed', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    const cancelled = await call('POST /api/admin/coach/connect/orcarouter/cancel', { generation: started.body.generation });
    assert.equal(cancelled.status, 200);
    assert.equal(oauth.registry.isPending(), false);

    const late = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: started.body.generation, code: 'c' });
    assert.equal(late.status, 409);
    assert.equal(srv.seen.length, 0, 'the code was never spent');
    assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null);

    // Cancel is idempotent — the Cancel button, a provider switch and pagehide may all fire it.
    assert.equal((await call('POST /api/admin/coach/connect/orcarouter/cancel', {})).status, 200);
  } finally { await srv.close(); }
});

test('a second sign-in replaces the first, and the superseded generation cannot fill the slot', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const first = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    const second = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    assert.ok(second.body.generation > first.body.generation);
    assert.notEqual(first.body.url, second.body.url, 'a fresh verifier and state every attempt');

    // The abandoned attempt's code arrives late. It must not write the credential.
    const stale = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: first.body.generation, code: 'stale-code' });
    assert.equal(stale.status, 409);
    assert.equal(srv.seen.length, 0);
    assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null, 'a late response never overwrites the newer login');

    // The current one still works.
    const ok = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: second.body.generation, code: 'good-code' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally { await srv.close(); }
});

test('a code rejected by the endpoint leaves nothing stored and says what happened', async () => {
  const answers = [
    [{ status: 403, body: { error: 'invalid_grant', error_description: 'code already used' } }, /already been used/i],
    [{ status: 403, body: { error: 'invalid_grant', error_description: 'code expired' } }, /expired/i],
    [{ status: 400, body: { error: 'invalid_request' } }, /challenge method/i],
    [{ status: 429, body: { error: 'rate_limited' } }, /limiting/i]
  ];
  for (const [answer, pattern] of answers) {
    const srv = await fakeAuthServer(answer);
    try {
      fresh();
      const call = harness();
      const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
      const r = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: started.body.generation, code: 'c' });

      assert.equal(r.body.ok, false, JSON.stringify(answer));
      assert.match(r.body.error, pattern);
      assert.equal(r.status, answer.status === 429 ? 429 : 400);
      assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null, 'nothing was saved');
      assert.equal(oauth.registry.isPending(), false, 'the lock is released even on a rejection');
      // The refusal never quotes the request back — no verifier, no key.
      const body = JSON.stringify(r.body);
      assert.ok(!body.includes('sk-orca'), 'no key in an error');
    } finally { await srv.close(); }
  }
});

test('an unreachable auth origin is a network failure with a usable message, not a hang or a crash', async () => {
  fresh();
  const saved = process.env.ORCA_AUTH_BASE_URL;
  // A port nothing is listening on: the connection is refused immediately.
  process.env.ORCA_AUTH_BASE_URL = 'http://127.0.0.1:9';
  try {
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    assert.equal(started.status, 200);
    const r = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: started.body.generation, code: 'c' });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /Could not reach|did not answer/i);
    assert.equal(oauth.registry.isPending(), false, 'a transport failure releases the lock too');
  } finally {
    if (saved === undefined) delete process.env.ORCA_AUTH_BASE_URL; else process.env.ORCA_AUTH_BASE_URL = saved;
  }
});

test('a redirect-shaped delivery is refused when its state does not match, and nothing is exchanged', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    const attempt = oauth.registry.attemptFor(started.body.generation);
    const bad = await oauth.exchange({ attempt, code: 'attacker-code', state: 'not-the-state' });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'state-mismatch');
    assert.equal(srv.seen.length, 0, 'a code that arrived with the wrong state is never spent');
    assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null);
  } finally { await srv.close(); }
});

test('an expired attempt is refused by the route, and the card can start a new one', async () => {
  fresh();
  const call = harness();
  const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
  // Age the pending attempt past its window.
  const pending = oauth.registry.attemptFor(started.body.generation);
  pending.expiresAt = Date.now() - 1;
  const r = await call('POST /api/admin/coach/connect/orcarouter/complete', { generation: started.body.generation, code: 'c' });
  assert.equal(r.status, 409);
  assert.equal(oauth.registry.isPending(), false);
  const again = await call('POST /api/admin/coach/connect/orcarouter/start', {});
  assert.equal(again.status, 200, 'and a fresh attempt is available immediately');
});

test('disconnect removes the credential and drops any sign-in in flight', async () => {
  const srv = await fakeAuthServer();
  try {
    fresh();
    const call = harness();
    await call('POST /api/admin/coach/connect/orcarouter/start', {});
    assert.equal(oauth.registry.isPending(), true);
    const disc = await call('POST /api/admin/coach/disconnect', { provider: 'orcarouter' });
    assert.equal(disc.status, 200);
    assert.equal(oauth.registry.isPending(), false, 'a removal is also the end of a pending sign-in');
    assert.equal(cfg.authFor(cfg.load(), 'orcarouter'), null);
  } finally { await srv.close(); }
});

test('the admin card reports both credential choices without ever returning the key', async () => {
  fresh();
  const call = harness();
  await call('POST /api/admin/coach/connect', { provider: 'orcarouter', type: 'apikey', token: 'sk-orca-stored-0001', account: 'me@example.com' });

  const r = await call('GET /api/admin/coach');
  assert.equal(r.status, 200);
  const orca = r.body.providers.find(p => p.id === 'orcarouter');
  assert.equal(orca.label, 'OrcaRouter');
  assert.equal(orca.apiKey, true, 'the API-key choice is offered');
  assert.equal(orca.connect, 'pkce', 'and the account choice beside it');
  assert.equal(orca.catalog, 'chat', 'the model list is a filtered catalog');
  assert.equal(orca.connected, true);
  assert.equal(orca.keyPlaceholder, 'sk-orca-…');

  assert.equal(r.body.auth.state, 'connected');
  assert.equal(r.body.auth.type, 'apikey');
  assert.equal(r.body.auth.account, 'me@example.com');
  assert.ok(!JSON.stringify(r.body).includes('sk-orca-stored-0001'), 'the key never comes back out');
  assert.equal(r.body.baseUrl, 'https://api.orcarouter.ai');
});

test('the models route narrows by capability and refuses a capability it does not know', async () => {
  fresh();
  const call = harness();
  const bad = await call('POST /api/admin/coach/models', { capability: 'telepathy' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /unknown capability/);

  // Without a key the catalog falls back to the verified seed, marked as such — never free text.
  const r = await call('POST /api/admin/coach/models', { capability: 'chat' });
  assert.equal(r.status, 200);
  assert.equal(r.body.degraded, true);
  assert.equal(r.body.catalogSource, 'verified seed');
  assert.deepEqual(r.body.models, ['anthropic/claude-opus-4.8', 'deepseek/deepseek-v4-pro', 'google/gemini-3.5-flash', 'openai/gpt-5.5', 'orcarouter/auto']);
});

test('the auth override never leaks into the inference path, and vice versa', async () => {
  const srv = await fakeAuthServer();
  const savedApi = process.env.ORCA_API_BASE_URL;
  process.env.ORCA_API_BASE_URL = 'https://relay.self-hosted.example';
  try {
    fresh();
    const call = harness();
    const started = await call('POST /api/admin/coach/connect/orcarouter/start', {});
    assert.ok(started.body.url.startsWith(srv.origin), 'authorize follows the auth origin');
    assert.equal(authBase(), srv.origin);

    // The card reports the inference base, which followed its own override.
    const card = await call('GET /api/admin/coach');
    assert.equal(card.body.baseUrl, 'https://relay.self-hosted.example');
    assert.ok(!card.body.baseUrl.includes('127.0.0.1'), 'the auth origin did not bleed into inference');
  } finally {
    if (savedApi === undefined) delete process.env.ORCA_API_BASE_URL; else process.env.ORCA_API_BASE_URL = savedApi;
    await srv.close();
  }
});

test('a shared self-hosted base points both origins at one address', async () => {
  const srv = await fakeAuthServer();
  const savedAuth = process.env.ORCA_AUTH_BASE_URL;
  const savedApi = process.env.ORCA_API_BASE_URL;
  delete process.env.ORCA_AUTH_BASE_URL;
  delete process.env.ORCA_API_BASE_URL;
  process.env.ORCA_BASE_URL = srv.origin;
  try {
    fresh();
    assert.equal(authBase(), srv.origin);
    const { apiBase } = await import('../coach/core/origins.js');
    assert.equal(apiBase(), srv.origin, 'one origin for a self-hosted deployment serving both');
  } finally {
    delete process.env.ORCA_BASE_URL;
    if (savedAuth !== undefined) process.env.ORCA_AUTH_BASE_URL = savedAuth;
    if (savedApi !== undefined) process.env.ORCA_API_BASE_URL = savedApi;
    await srv.close();
  }
});

test('no test in this file wrote a real credential, and the data dir holds only ciphertext', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = path.join(dataDir, 'coach.json');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!/"token"\s*:\s*"/.test(raw), 'a plaintext token must never be on disk');
  assert.ok(!/sk-orca-[A-Za-z0-9_-]{8,}/.test(raw) || !raw.includes('"token"'), 'the store holds sealed blobs');
});
