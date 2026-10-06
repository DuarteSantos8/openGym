/* OrcaRouter: the two credential adapters, the PKCE flow, the two origins, and the capability
 * catalog.
 *
 * The through-line of this file is that an API key pasted from the console and one minted by a
 * browser authorization are the same credential — so the assertions are written to prove the
 * *seam*, not each path in isolation: both adapters are driven, both results are compared, and
 * the transport and catalog are shown to read one field without asking which ran.
 *
 * Everything here uses fake keys, fake codes and a local mock. The one test that reaches the
 * network is gated on ORCAROUTER_API_KEY and skips without it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData } from './helpers.mjs';

tempData();

const credentials = await import('../coach/core/credentials.js');
const oauth = await import('../coach/core/oauth.js');
const origins = await import('../coach/core/origins.js');
const catalog = await import('../coach/core/catalog.js');
const { HTTP_PROVIDERS, baseUrlFor } = await import('../coach/core/providers.js');
const orcarouter = (await import('../coach/core/adapters/orcarouter.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const compatible = (await import('../coach/core/adapters/compatible.js')).default;

/** A fetch that records every request and answers from a script — the same shape the existing
 *  adapter tests use, so an aborted signal never puts anything on the wire. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    calls.push({ url, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const a = typeof answers === 'function' ? answers(calls.length, url, init) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
  };
  f.calls = calls;
  return f;
}
const ok = body => ({ status: 200, body });

/* ============================ the two origins ============================ */

test('auth and inference resolve to different origins, and neither is derived from the other', () => {
  assert.equal(origins.authBase({}), 'https://www.orcarouter.ai');
  assert.equal(origins.apiBase({}), 'https://api.orcarouter.ai');
  assert.equal(origins.apiV1({}), 'https://api.orcarouter.ai/v1');
  // The mistake this exists to prevent: /v1/auth/keys on the inference host is a 404, and no
  // amount of hostname substitution gets you from one to the other.
  assert.ok(!origins.apiBase({}).includes('www.'));
  assert.equal(origins.apiBase({}).replace('api.', 'www.') + '/v1', 'https://www.orcarouter.ai/v1', 'and appending /v1 to it is not the auth endpoint either');
});

test('explicit per-origin overrides win over the shared one, which wins over the defaults', () => {
  const shared = { ORCA_BASE_URL: 'https://orca.internal' };
  assert.equal(origins.authBase(shared), 'https://orca.internal');
  assert.equal(origins.apiBase(shared), 'https://orca.internal', 'a self-hosted gateway serving both from one address');

  const split = { ORCA_BASE_URL: 'https://orca.internal', ORCA_AUTH_BASE_URL: 'https://id.example.com', ORCA_API_BASE_URL: 'https://relay.example.com/' };
  assert.equal(origins.authBase(split), 'https://id.example.com');
  assert.equal(origins.apiBase(split), 'https://relay.example.com', 'trailing slash trimmed, explicit beats shared');

  // An explicit override alone still works when there is no shared base.
  assert.equal(origins.authBase({ ORCA_AUTH_BASE_URL: 'https://auth.only' }), 'https://auth.only');
  assert.equal(origins.apiBase({ ORCA_API_BASE_URL: 'https://api.only' }), 'https://api.only');
});

test('a remote origin must be HTTPS; loopback may be plain HTTP for a local fake', () => {
  assert.equal(origins.normalizeOrigin('http://evil.example.com', { fallback: 'X' }), 'X', 'cleartext to a remote host is refused');
  assert.equal(origins.normalizeOrigin('http://127.0.0.1:9999', { fallback: 'X' }), 'http://127.0.0.1:9999');
  assert.equal(origins.normalizeOrigin('http://localhost:8080', { fallback: 'X' }), 'http://localhost:8080');
  // A credential in the URL, a non-http scheme, and unparseable input all fall back rather than throw.
  assert.equal(origins.normalizeOrigin('https://u:p@h.example', { fallback: 'X' }), 'X');
  assert.equal(origins.normalizeOrigin('ftp://h.example', { fallback: 'X' }), 'X');
  assert.equal(origins.normalizeOrigin('not a url', { fallback: 'X' }), 'X');
  assert.equal(origins.normalizeOrigin('', { fallback: 'X' }), 'X');
  // A path on an origin is dropped: /v1 belongs to the URL the caller builds.
  assert.equal(origins.normalizeOrigin('https://h.example/some/path', { fallback: 'X' }), 'https://h.example');
});

test('the provider entry resolves its own base through origins, and a configured base still wins', () => {
  // The bare origin: every path in the spec already carries its own /v1, exactly as it does for
  // OpenAI — so the requests land on https://api.orcarouter.ai/v1/... without a doubled segment.
  assert.equal(baseUrlFor('orcarouter', {}), 'https://api.orcarouter.ai');
  assert.equal(baseUrlFor('orcarouter', {}) + '/v1/models', 'https://api.orcarouter.ai/v1/models');
  assert.equal(baseUrlFor('orcarouter', { providerOptions: { orcarouter: { baseUrl: 'http://127.0.0.1:1234/' } } }), 'http://127.0.0.1:1234');
  // The other providers are untouched by the resolver.
  assert.equal(baseUrlFor('anthropic', {}), 'https://api.anthropic.com');
  assert.equal(baseUrlFor('compatible', {}), '');
});

/* ============================ the API-key adapter ============================ */

test('the API-key adapter accepts a well-formed key and rejects what is obviously not one', () => {
  const good = credentials.apiKeyAdapter.acquire({ token: '  sk-orca-abcdefghijklmnop  ' });
  assert.equal(good.ok, true);
  assert.equal(good.token, 'sk-orca-abcdefghijklmnop', 'trimmed, never stored with the padding');
  assert.equal(good.type, 'apikey');
  assert.equal(good.via, 'api-key');

  // A key for another service is caught before it is stored and quietly sent to the wrong host.
  for (const [bad, reason] of [['', 'empty'], ['sk-ant-abc', 'prefix'], ['sk-oa-abc', 'prefix'], ['sk-orca-short', 'short'], ['sk-orca-abc def ghijk', 'whitespace']]) {
    const r = credentials.apiKeyAdapter.acquire({ token: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, reason);
    assert.ok(r.message);
    assert.equal(r.token, undefined, 'no token ever comes back from a rejection');
  }
});

test('validateKeyShape never claims to have verified anything — only the prefix and the length', () => {
  // This is the honest limitation: a prefix is not proof of validity and nothing here pretends
  // otherwise, which is why the first real request is what establishes it.
  assert.equal(credentials.validateKeyShape('sk-orca-zzzzzzzzzzzzzzzzzzzz').ok, true);
  assert.ok(!/valid|verified|works/i.test(credentials.validateKeyShape('sk-orca-zzzzzzzzzzzzzzzzzzzz').message || ''));
});

/* ============================ PKCE: the attempt ============================ */

test('every attempt is a fresh verifier and state from the crypto RNG, and the challenge is S256 of it', () => {
  const a = oauth.createAttempt();
  const b = oauth.createAttempt();
  assert.notEqual(a.verifier, b.verifier, 'a reused verifier is the whole bug PKCE exists to prevent');
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.challenge, b.challenge);
  assert.equal(a.method, 'S256');
  assert.equal(a.challenge, oauth.challengeFor(a.verifier));
  // base64url of a 32-byte digest, unpadded: 43 characters, no '=' and no '+/'.
  assert.match(a.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.challenge.length, 43);
  assert.ok(!a.challenge.includes('='));
  // High entropy, not a timestamp or a counter.
  assert.ok(a.verifier.length >= 43, 'a 32-byte verifier is 43 base64url characters');
  assert.ok(!/\d{10,}/.test(a.verifier), 'no embedded timestamp');
});

test('the challenge is stable for one verifier and different for another — the endpoint re-hashes to check', () => {
  assert.equal(oauth.challengeFor('fixed-verifier'), oauth.challengeFor('fixed-verifier'));
  assert.notEqual(oauth.challengeFor('fixed-verifier'), oauth.challengeFor('fixed-verifier2'));
  // The documented value: base64url(sha256("abc")) with no padding.
  assert.equal(oauth.challengeFor('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
});

test('state comparison is constant-time-ish and refuses a missing or wrong state', () => {
  assert.equal(oauth.stateMatches('abc123', 'abc123'), true);
  assert.equal(oauth.stateMatches('abc123', 'abc124'), false);
  assert.equal(oauth.stateMatches('abc123', 'abc12'), false, 'a shorter value must not throw');
  assert.equal(oauth.stateMatches('abc123', null), false);
  assert.equal(oauth.stateMatches('abc123', undefined), false);
  assert.equal(oauth.stateMatches('', ''), true);
});

/* ============================ PKCE: the authorize URL ============================ */

test('the authorize URL carries the challenge, S256, the state and callback_url=oob — and never the verifier', () => {
  const a = oauth.createAttempt();
  const url = credentials.buildAuthorizeUrl(a, {});
  const u = new URL(url);
  assert.equal(u.origin, 'https://www.orcarouter.ai');
  assert.equal(u.pathname, '/auth');
  assert.equal(u.searchParams.get('callback_url'), 'oob', 'the spelling is deliberate: the mode is asked for, not guessed');
  assert.equal(u.searchParams.get('code_challenge'), a.challenge);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256', 'mandatory in Flow B — a displayed code is handled by a person');
  assert.equal(u.searchParams.get('state'), a.state);
  assert.equal(u.searchParams.get('scope'), 'api');
  assert.equal(u.searchParams.get('app_name'), 'openGym');
  // The two things that must not be there.
  assert.ok(!url.includes(a.verifier), 'the verifier never leaves the process');
  assert.ok(!/client_secret|client_id/.test(url), 'no client secret and no pre-registered client');
  assert.equal(u.searchParams.get('delivery'), null, 'appending delivery=code would do nothing; it is not sent');
});

test('the authorize URL follows an auth override, and login_hint is bounded', () => {
  const a = oauth.createAttempt();
  const url = credentials.buildAuthorizeUrl(a, { base: 'http://127.0.0.1:9999', loginHint: 'x'.repeat(500) });
  assert.ok(url.startsWith('http://127.0.0.1:9999/auth?'), url);
  assert.equal(new URL(url).searchParams.get('login_hint').length, 200);
});

/* ============================ PKCE: the exchange ============================ */

const attempt = () => ({ ...oauth.createAttempt(), expiresAt: Date.now() + 60000 });

test('the exchange POSTs to /api/v1/auth/keys on the AUTH origin, with the verifier in the body', async () => {
  const a = attempt();
  const f = fakeFetch([ok({ key: 'sk-orca-minted-key-0001', user_id: '12345', scope: 'api' })]);
  const r = await oauth.exchange({ attempt: a, code: 'the-code', fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.token, 'sk-orca-minted-key-0001');
  assert.equal(r.account, '12345');

  const c = f.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://www.orcarouter.ai/api/v1/auth/keys');
  // The mistake the docs call out by name: the relay is at /v1, the auth endpoints are not.
  assert.equal(new URL(c.url).origin, 'https://www.orcarouter.ai');
  assert.equal(new URL(c.url).pathname, '/api/v1/auth/keys', 'the auth path keeps its /api prefix');
  assert.notEqual(new URL(c.url).pathname, '/v1/auth/keys', 'the known 404 shape');
  assert.ok(!c.url.includes('api.orcarouter.ai'), 'the exchange never goes to the inference origin');
  assert.deepEqual(c.body, { code: 'the-code', code_verifier: a.verifier, code_challenge_method: 'S256' });
  assert.ok(!c.url.includes(a.verifier), 'the verifier is in the body, not the URL');
});

test('the exchange follows an explicit base, so the whole flow can be driven against a local fake', async () => {
  const a = attempt();
  const f = fakeFetch([ok({ key: 'sk-orca-x0000000000001', scope: 'api' })]);
  await oauth.exchange({ attempt: a, code: 'c', base: 'http://127.0.0.1:9998', fetch: f });
  assert.equal(f.calls[0].url, 'http://127.0.0.1:9998/api/v1/auth/keys');
});

test('a redirect-shaped delivery is checked for state BEFORE the code is spent', async () => {
  const a = attempt();
  const f = fakeFetch([ok({ key: 'sk-orca-never', scope: 'api' })]);
  const r = await oauth.exchange({ attempt: a, code: 'c', state: 'not-the-state', fetch: f });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'state-mismatch');
  assert.equal(f.calls.length, 0, 'nothing was sent — an attacker-supplied code must not be redeemable');
  const good = await oauth.exchange({ attempt: a, code: 'c', state: a.state, fetch: fakeFetch([ok({ key: 'sk-orca-y0000000000001', scope: 'api' })]) });
  assert.equal(good.ok, true, 'the matching state still goes through');
});

test('every exchange failure is classified, and none of them leaks the verifier or the response body', async () => {
  const cases = [
    [403, { error: 'invalid_grant', error_description: 'code expired' }, 'expired'],
    [403, { error: 'invalid_grant', error_description: 'code already used' }, 'already-used'],
    [403, { error: 'invalid_grant', error_description: 'code_verifier mismatch' }, 'bad-verifier'],
    [403, { error: 'invalid_grant' }, 'already-used'],
    [400, { error: 'invalid_request', error_description: 'unrecognised code_challenge_method' }, 'method-mismatch'],
    [400, { error: 'invalid_request' }, 'method-mismatch'],
    [429, { error: 'rate_limited' }, 'rate-limited'],
    [500, { error: 'boom' }, 'bad-response']
  ];
  for (const [status, body, reason] of cases) {
    const a = attempt();
    const r = await oauth.exchange({ attempt: a, code: 'c', fetch: fakeFetch([{ status, body }]) });
    assert.equal(r.ok, false, `${status} ${reason}`);
    assert.equal(r.reason, reason);
    assert.ok(r.message, 'a person gets something actionable');
    const seen = JSON.stringify(r);
    assert.ok(!seen.includes(a.verifier), 'the verifier is not in the error');
    assert.ok(!seen.includes('boom'), 'the provider\'s own words are not echoed back verbatim');
    assert.equal(r.token, undefined);
  }
});

test('a transport failure and a timeout are not credential verdicts, and an abort is a cancel', async () => {
  const a = attempt();
  const net = await oauth.exchange({ attempt: a, code: 'c', fetch: fakeFetch([new Error('ECONNREFUSED')]) });
  assert.equal(net.reason, 'network');
  const to = await oauth.exchange({ attempt: a, code: 'c', fetch: fakeFetch([Object.assign(new Error('aborted'), { name: 'AbortError' })]) });
  assert.equal(to.reason, 'timeout');

  const ctl = new AbortController(); ctl.abort();
  const cancelled = await oauth.exchange({ attempt: a, code: 'c', fetch: fakeFetch([ok({})]), signal: ctl.signal });
  assert.equal(cancelled.reason, 'cancelled');
});

test('an expired attempt is refused before anything is sent, and an empty code never reaches the wire', async () => {
  const stale = { ...oauth.createAttempt(), expiresAt: Date.now() - 1 };
  const f = fakeFetch([ok({ key: 'sk-orca-nope' })]);
  assert.equal((await oauth.exchange({ attempt: stale, code: 'c', fetch: f })).reason, 'expired');
  assert.equal((await oauth.exchange({ attempt: attempt(), code: '   ', fetch: f })).ok, false);
  assert.equal(f.calls.length, 0);
});

test('the granted scope is read back, and a downgrade is refused rather than assumed away', async () => {
  // Asking for `connector` and being granted `api` means a workspace role approved less than was
  // requested. Continuing silently would fail later with a confusing error instead of here.
  const narrowed = await oauth.exchange({ attempt: attempt(), code: 'c', scope: 'connector', fetch: fakeFetch([ok({ key: 'sk-orca-a0000000000001', scope: 'api' })]) });
  assert.equal(narrowed.ok, false);
  assert.equal(narrowed.reason, 'scope-insufficient');
  assert.equal(narrowed.granted, 'api');
  assert.equal(narrowed.requested, 'connector');

  // What was asked for and granted: fine.
  const fine = await oauth.exchange({ attempt: attempt(), code: 'c', scope: 'api', fetch: fakeFetch([ok({ key: 'sk-orca-b0000000000001', scope: 'api' })]) });
  assert.equal(fine.ok, true);
  assert.equal(fine.scope, 'api');

  // A response with no scope at all is accepted for the scope we asked for — the endpoint did not
  // downgrade, it simply did not restate it.
  const silent = await oauth.exchange({ attempt: attempt(), code: 'c', scope: 'api', fetch: fakeFetch([ok({ key: 'sk-orca-c0000000000001' })]) });
  assert.equal(silent.ok, true);
});

test('a 200 without a usable key is a bad response, not a crash and not a credential', async () => {
  for (const body of [{}, { key: '' }, { key: 123 }, 'not json at all', { user_id: '1' }]) {
    const r = await oauth.exchange({ attempt: attempt(), code: 'c', fetch: fakeFetch([ok(body)]) });
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.reason, 'bad-response');
  }
});

/* ============================ the pending-attempt registry ============================ */

test('the registry holds one attempt, hands the verifier to its own generation only, and expires on read', () => {
  const reg = oauth.createRegistry({ ttlMs: 50 });
  const a = reg.start();
  assert.equal(reg.isPending(), true);
  assert.equal(reg.peek().generation, a.generation);
  assert.equal(reg.verifierFor(a.generation), a.verifier);
  assert.equal(reg.verifierFor(a.generation + 1), null, 'a stale generation gets nothing');

  // peek() hands out the state and challenge but never the verifier.
  const view = reg.peek();
  assert.equal(view.verifier, undefined);
  assert.ok(!JSON.stringify(view).includes(a.verifier));

  assert.equal(reg.clear(a.generation + 1), false, 'a different generation cannot clear this one');
  assert.equal(reg.isPending(), true);
  assert.equal(reg.clear(a.generation), true);
  assert.equal(reg.isPending(), false);
  assert.equal(reg.clear(a.generation), false, 'idempotent — Cancel, a provider switch and pagehide can all call it');
});

test('a second attempt replaces the first and invalidates its generation', () => {
  const reg = oauth.createRegistry();
  const first = reg.start();
  const second = reg.start();
  assert.ok(second.generation > first.generation, 'generations increase monotonically');
  assert.equal(reg.verifierFor(first.generation), null, 'a late completion from the abandoned attempt is refused');
  assert.equal(reg.verifierFor(second.generation), second.verifier);
  assert.notEqual(first.verifier, second.verifier);
});

test('an expired attempt is not pending and cannot be redeemed', async () => {
  const reg = oauth.createRegistry({ ttlMs: -1 });
  const a = reg.start();
  assert.equal(reg.isPending(), false, 'expiry is evaluated on read, not on a timer');
  assert.equal(reg.attemptFor(a.generation), null);
  assert.equal(reg.peek(), null);
});

/* ============================ the catalog and its capability rules ============================ */

// Fixtures covering every capability the rule knows about, so each branch is exercised by a
// record that declares it rather than by a name that looks like it.
const CATALOG_FIXTURE = [
  { id: 'vendor/text-only', supported_endpoint_types: ['openai'], architecture: { input_modalities: ['text'] }, context_length: 128000, reasoning: true, reasoning_efforts: ['low', 'high'] },
  { id: 'vendor/image-chat', supported_endpoint_types: ['openai', 'anthropic'], architecture: { input_modalities: ['text', 'image'] }, context_length: 200000 },
  { id: 'vendor/audio-chat', supported_endpoint_types: ['gemini'], architecture: { input_modalities: ['text', 'audio'] }, context_length: 200000 },
  { id: 'vendor/video-chat', supported_endpoint_types: ['openai-response'], architecture: { input_modalities: ['text', 'video'] }, context_length: 200000 },
  { id: 'vendor/embed', supported_endpoint_types: ['embeddings'], architecture: { input_modalities: ['text'] } },
  { id: 'vendor/imagegen', supported_endpoint_types: ['image-generation'], architecture: { input_modalities: ['text'] } },
  { id: 'vendor/video', supported_endpoint_types: ['openai-video'], architecture: { input_modalities: ['text'] } },
  { id: 'vendor/rerank', supported_endpoint_types: ['jina-rerank'], architecture: { input_modalities: ['text'] } },
  { id: 'vendor/silent', architecture: { input_modalities: ['text'] } },
  { id: 'vendor/mystery' }
];
const records = catalog.normalizeCatalog({ data: CATALOG_FIXTURE });
const idsFor = (cap, opts) => catalog.filterCatalog(records, cap, opts);

test('the catalog parser keeps what it understands and drops what it does not', () => {
  assert.equal(records.length, CATALOG_FIXTURE.length);
  const byId = Object.fromEntries(records.map(m => [m.id, m]));
  assert.equal(byId['vendor/text-only'].context, 128000);
  assert.deepEqual(byId['vendor/text-only'].inputModalities, ['text']);
  assert.equal(byId['vendor/text-only'].reasoning, true);
  assert.deepEqual(byId['vendor/text-only'].reasoningEfforts, ['low', 'high']);
  assert.equal(byId['vendor/embed'].context, null, 'absent is null, not zero');
  assert.equal(byId['vendor/mystery'].endpointTypes.length, 0);
  // Junk is dropped rather than coerced.
  assert.equal(catalog.normalizeCatalog({ data: [null, 42, {}, { id: 7 }, 'ok-model'] }).length, 1);
  assert.equal(catalog.normalizeCatalog({ data: 'nope' }), null);
  assert.equal(catalog.normalizeCatalog(null), null);
  assert.equal(catalog.normalizeCatalog({}), null);
});

test('chat keeps general text models, and refuses the specialists and the undeclared', () => {
  const chat = idsFor('chat');
  assert.ok(chat.includes('vendor/text-only'));
  assert.ok(chat.includes('vendor/image-chat'), 'a multimodal model is a chat model');
  assert.ok(!chat.includes('vendor/embed'), 'embeddings are not chat');
  assert.ok(!chat.includes('vendor/imagegen'), 'an image generator must not be offered for a text job');
  assert.ok(!chat.includes('vendor/video'));
  assert.ok(!chat.includes('vendor/rerank'));
  assert.ok(!chat.includes('vendor/silent'), 'no declared endpoint type fails closed');
  assert.ok(!chat.includes('vendor/mystery'));
});

test('a non-text modality filter is fail-closed: only a model that declared it survives', () => {
  assert.deepEqual(idsFor('chat', { modality: 'image' }), ['vendor/image-chat']);
  assert.deepEqual(idsFor('chat', { modality: 'audio' }), ['vendor/audio-chat']);
  assert.deepEqual(idsFor('chat', { modality: 'video' }), ['vendor/video-chat']);
  // A model that never declared the modality is not assumed to have it.
  assert.ok(!idsFor('chat', { modality: 'image' }).includes('vendor/silent'));
  assert.ok(!idsFor('chat', { modality: 'image' }).includes('vendor/text-only'));
});

test('embedding, image, video and rerank each match their own endpoint type and nothing else', () => {
  assert.deepEqual(idsFor('embedding'), ['vendor/embed']);
  assert.deepEqual(idsFor('image'), ['vendor/imagegen']);
  assert.deepEqual(idsFor('video'), ['vendor/video']);
  assert.deepEqual(idsFor('rerank'), ['vendor/rerank']);
  assert.ok(!idsFor('embedding').includes('vendor/text-only'), 'a chat model is not an embedding model');
});

test('the catalog is bounded: item count, id length and modality list are all capped', () => {
  const many = { data: Array.from({ length: catalog.MAX_CATALOG_ITEMS + 500 }, (_, i) => ({ id: 'm' + i })) };
  assert.equal(catalog.normalizeCatalog(many).length, catalog.MAX_CATALOG_ITEMS);
  const long = catalog.normalizeModel({ id: 'x'.repeat(5000) });
  assert.equal(long.id.length, catalog.MAX_MODEL_ID);
  const mods = catalog.normalizeModel({ id: 'a', architecture: { input_modalities: Array.from({ length: 100 }, (_, i) => 'mod' + i) } });
  assert.equal(mods.inputModalities.length, catalog.MAX_MODALITIES);
});

/* ---------------------------- the verified seed ---------------------------- */

test('the seed keeps its reasoning ladder and modality metadata, and is filtered like a live list', () => {
  assert.deepEqual(catalog.seedFor('chat'), ['openai/gpt-5.5', 'anthropic/claude-opus-4.8', 'google/gemini-3.5-flash', 'deepseek/deepseek-v4-pro', 'orcarouter/auto']);
  assert.deepEqual(catalog.seedFor('chat', { modality: 'image' }), ['openai/gpt-5.5', 'anthropic/claude-opus-4.8', 'google/gemini-3.5-flash']);
  // GPT-5.5's verified effort ladder must survive; losing it is the regression the guide names.
  const gpt = catalog.seedModel('openai/gpt-5.5');
  assert.deepEqual([...gpt.reasoningEfforts], ['low', 'medium', 'high', 'xhigh']);
  assert.equal(gpt.reasoning, true);
  assert.equal(gpt.context, 400000);
  assert.ok(gpt.inputModalities.includes('image'));
  assert.equal(gpt.source, 'campaign-verified seed', 'every seed entry says where it came from');
  // The seed declares no embedding/image/video/rerank model, so those pickers stay empty rather
  // than being padded with something that cannot do the job.
  assert.deepEqual(catalog.seedFor('embedding'), []);
  assert.deepEqual(catalog.seedFor('image'), []);
});

test('every seed entry is a record the parser would have accepted, so seed and live behave alike', () => {
  for (const m of catalog.VERIFIED_SEED) {
    assert.ok(m.id.includes('/'), `${m.id} keeps its vendor namespace`);
    assert.ok(Array.isArray(m.endpointTypes) && m.endpointTypes.length, `${m.id} declares endpoint types`);
    assert.ok(Array.isArray(m.inputModalities) && m.inputModalities.length, `${m.id} declares input modalities`);
    assert.equal(catalog.supportsCapability(m, 'chat'), true, `${m.id} is offered for chat`);
  }
});

/* ============================ the OrcaRouter adapter ============================ */

test('the adapter is a first-class HTTPS provider that spawns nothing, like the other three', () => {
  assert.equal(orcarouter.id, 'orcarouter');
  assert.equal(orcarouter.spawns, false);
  assert.equal(orcarouter.needsRuntime, false);
  assert.ok(HTTP_PROVIDERS.orcarouter);
  assert.equal(HTTP_PROVIDERS.orcarouter.label, 'OrcaRouter');
  assert.equal(HTTP_PROVIDERS.orcarouter.apiKeyEnv, 'ORCAROUTER_API_KEY');
  assert.equal(HTTP_PROVIDERS.orcarouter.defaultModel, 'orcarouter/auto');
  assert.equal(HTTP_PROVIDERS.orcarouter.connect, 'pkce', 'the second credential choice is declared here');
});

test('inference goes to api.orcarouter.ai/v1 with a bearer key, and the vendor namespace is preserved', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: '{"coach_contract":1,"nochange":true,"reading":"ok"}' }, finish_reason: 'stop' }] })]);
  const r = await orcarouter.invoke({ cfg: {}, prompt: 'P', env: { ORCAROUTER_API_KEY: 'sk-orca-test-key-1' }, model: 'anthropic/claude-opus-4.8', fetch: f });
  assert.equal(r.code, 0);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.orcarouter.ai/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer sk-orca-test-key-1');
  assert.equal(c.body.model, 'anthropic/claude-opus-4.8', 'the model id is sent exactly as the catalog gave it');
  assert.equal(c.body.temperature, 0, 'a plan diff wants determinism');
  assert.ok(c.body.max_tokens >= 8000);
  assert.equal(c.body.max_completion_tokens, undefined, 'the gateway normalizes max_tokens across vendors');
  assert.ok(!c.url.includes('sk-orca'), 'the key is never in the URL');
});

test('the adapter follows a self-hosted base override without touching the auth origin', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] })]);
  await orcarouter.invoke({
    cfg: { providerOptions: { orcarouter: { baseUrl: 'http://127.0.0.1:1234' } } },
    prompt: 'P', env: { ORCAROUTER_API_KEY: 'sk-orca-k' }, model: 'm', fetch: f
  });
  assert.equal(f.calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions');
});

test('model discovery asks for the chat capability and keeps only chat models', async () => {
  const f = fakeFetch([ok({ data: CATALOG_FIXTURE })]);
  const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: 'sk-orca-k' }, { fetch: f });
  assert.equal(r.ok, true);
  assert.equal(new URL(f.calls[0].url).searchParams.get('capability'), 'chat');
  assert.equal(f.calls[0].url, 'https://api.orcarouter.ai/v1/models?capability=chat');
  assert.equal(f.calls[0].headers.authorization, 'Bearer sk-orca-k');
  assert.deepEqual(r.models, ['vendor/audio-chat', 'vendor/image-chat', 'vendor/text-only', 'vendor/video-chat']);
  assert.equal(r.degraded, false);
  assert.equal(r.seed, false);
});

test('a catalog outage falls back to the verified seed, marked degraded, and never degrades to free text', async () => {
  for (const answer of [{ status: 503, body: { error: 'upstream down' } }, new Error('ENOTFOUND')]) {
    const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: 'sk-orca-k' }, { fetch: fakeFetch([answer]) });
    assert.equal(r.ok, false);
    assert.equal(r.degraded, true, 'the UI is told the list is a fallback, not a live catalog');
    assert.equal(r.seed, true);
    assert.equal(r.catalogSource, 'verified seed');
    assert.deepEqual(r.models, catalog.seedFor('chat').slice().sort(), 'the seed is filtered by the same rule and sorted like a live list');
  }
  // No key yet is the cold-start case: the seed is what makes a fresh install usable at all.
  const cold = await orcarouter.models({}, {}, { fetch: fakeFetch([]) });
  assert.equal(cold.degraded, true);
  assert.deepEqual(cold.models, catalog.seedFor('chat').slice().sort());
});

test('a live result is authoritative — the seed is never mixed into it', async () => {
  const f = fakeFetch([ok({ data: [{ id: 'vendor/only-model', supported_endpoint_types: ['openai'], architecture: { input_modalities: ['text'] } }] })]);
  const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: 'sk-orca-k' }, { fetch: f });
  assert.equal(r.ok, true);
  assert.deepEqual(r.models, ['vendor/only-model']);
  for (const seedId of catalog.seedFor('chat')) assert.ok(!r.models.includes(seedId), `${seedId} must not be merged into a live list`);
});

test('an endpoint serving the plain OpenAI list shape is not mistaken for "no chat models"', async () => {
  // No supported_endpoint_types at all: the endpoint serving that list under /v1/models is
  // serving chat by construction, so the ids pass rather than every model vanishing.
  const f = fakeFetch([ok({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] })]);
  const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: 'sk-orca-k' }, { fetch: f });
  assert.equal(r.ok, true);
  assert.deepEqual(r.models, ['gpt-x', 'gpt-y']);
});

test('the other providers keep their existing model discovery, unchanged', async () => {
  const f = fakeFetch([ok({ data: [{ id: 'gpt-5.6' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] })]);
  const r = await openai.models({}, { OPENAI_API_KEY: 'sk-oa' }, { fetch: f });
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/models', 'no capability query for a provider without a catalog');
  assert.equal(new URL(f.calls[0].url).searchParams.get('capability'), null);
  assert.deepEqual(r.models, ['gpt-5.6'], 'OpenAI keeps its own chat-name filter');
  const c = await compatible.models({ providerOptions: { compatible: { baseUrl: 'http://127.0.0.1:1' } } }, { OPENAI_COMPAT_API_KEY: 'k' }, { fetch: fakeFetch([ok({ data: ['a', 'b'] })]) });
  assert.deepEqual(c.models, ['a', 'b'], 'a compatible endpoint serves what it serves, unfiltered');
});

/* ============================ the seam: both adapters, one credential ============================ */

test('both adapters produce the same credential result, and downstream cannot tell which ran', async () => {
  const pasted = credentials.apiKeyAdapter.acquire({ token: 'sk-orca-pasted-key-0001' });
  const minted = await credentials.pkceAdapter.complete(oauth, attempt(), 'c', {
    fetch: fakeFetch([ok({ key: 'sk-orca-minted-key-0001', user_id: '999', scope: 'api' })])
  });
  assert.equal(minted.ok, true);

  // Same shape, same type, same field names — the only difference is the provenance label.
  assert.deepEqual(Object.keys(pasted).sort(), Object.keys(minted).sort());
  assert.equal(pasted.type, minted.type);
  assert.equal(pasted.type, 'apikey');
  assert.equal(pasted.via, 'api-key');
  assert.equal(minted.via, 'pkce');

  // And the transport reads one field, `env[ORCAROUTER_API_KEY]`, whichever adapter filled it.
  for (const cred of [pasted, minted]) {
    const f = fakeFetch([ok({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] })]);
    const r = await orcarouter.invoke({ cfg: {}, prompt: 'P', env: { ORCAROUTER_API_KEY: cred.token }, model: 'm', fetch: f });
    assert.equal(r.code, 0, cred.via);
    assert.equal(f.calls[0].headers.authorization, 'Bearer ' + cred.token, cred.via);
  }
  // Model discovery likewise.
  for (const cred of [pasted, minted]) {
    const f = fakeFetch([ok({ data: CATALOG_FIXTURE })]);
    const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: cred.token }, { fetch: f });
    assert.equal(r.ok, true, cred.via);
    assert.deepEqual(r.models, ['vendor/audio-chat', 'vendor/image-chat', 'vendor/text-only', 'vendor/video-chat'], cred.via);
  }
});

test('the adapter picker is one call site with two methods, and an unknown method is refused', () => {
  assert.deepEqual(Object.keys(credentials.ADAPTERS).sort(), ['api-key', 'pkce']);
  assert.equal(credentials.acquire('api-key', { token: 'sk-orca-aaaaaaaaaaaa' }).ok, true);
  const bad = credentials.acquire('device-grant', {});
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'unknown-method');
});

/* ============================ redaction ============================ */

test('redaction removes a key wherever it appears, including one echoed back by a provider', () => {
  const key = 'sk-orca-secret-value-0001';
  assert.ok(!credentials.redact(`failed with ${key}`, key).includes(key));
  assert.ok(!credentials.redact(`upstream said: ${key} is invalid`).includes(key), 'caught even when the caller did not pass it in');
  assert.equal(credentials.redact('nothing here', key), 'nothing here');
});

/* ============================ live ============================ */
/* The only test that leaves this machine, and only when the environment provides a key. It runs
 * through the adapter above — the same code path a job uses — not a bare fetch, so a green run
 * here means the integration works and not merely that the endpoint does. */

test('live: the model catalog is reachable through the adapter with a real key', { skip: !process.env.ORCAROUTER_API_KEY }, async () => {
  const r = await orcarouter.models({}, { ORCAROUTER_API_KEY: process.env.ORCAROUTER_API_KEY });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.degraded, false, 'a live run must not be reported as a fallback');
  assert.ok(r.models.length > 0);
  assert.equal(new URL(r.catalogSource).origin, 'https://api.orcarouter.ai');
  // Every id kept its vendor namespace.
  for (const id of r.models) assert.ok(id.includes('/'), id);
  console.log(`live catalog: ${r.models.length} chat models, e.g. ${r.models.slice(0, 3).join(', ')}`);
});
