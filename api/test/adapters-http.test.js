/* The four HTTPS providers, driven with a fake fetch.
 *
 * What is asserted is the request each one puts on the wire — URL, headers, body — and how
 * every way a call can go wrong lands in the { code, text, stderr } contract the pipeline
 * classifies. The classification itself is asserted through the real pipeline, so a change
 * to its regex and a change to an adapter's stderr cannot drift apart without a red build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const anthropic = (await import('../coach/core/adapters/anthropic.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const gemini = (await import('../coach/core/adapters/gemini.js')).default;
const compatible = (await import('../coach/core/adapters/compatible.js')).default;
const { attemptOnce } = await import('../coach/core/pipeline.js');
const { HTTP_PROVIDERS, validateBaseUrl } = await import('../coach/core/providers.js');
const { SYSTEM_PROMPT } = await import('../coach/core/system-prompt.js');

/** A fetch that records what it was asked and answers from a script. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const a = typeof answers === 'function' ? answers(calls.length, url, init) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
  };
  f.calls = calls;
  return f;
}
const ok = body => ({ status: 200, body });
const env = { ANTHROPIC_API_KEY: 'sk-ant-1', OPENAI_API_KEY: 'sk-oa-1', GEMINI_API_KEY: 'AIza-1', OPENAI_COMPAT_API_KEY: 'compat-1' };
const cfgCompat = { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://ollama.lan:11434/' } } };
const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';

test('the four HTTP adapters spawn nothing and need no runtime', () => {
  for (const a of [anthropic, openai, gemini, compatible]) {
    assert.equal(a.spawns, false, a.id);
    assert.equal(a.needsRuntime, false, a.id);
    assert.ok(HTTP_PROVIDERS[a.id], `${a.id} is described in core/providers.js`);
  }
});

test('Anthropic: /v1/messages with the key in a header, the shared system prompt, and the text joined back', async () => {
  const f = fakeFetch([ok({ content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }], stop_reason: 'end_turn' })]);
  const r = await anthropic.invoke({ cfg: {}, prompt: 'P', env, model: null, fetch: f });
  assert.equal(r.code, 0);
  assert.equal(r.text, '{"a":1}');
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['x-api-key'], 'sk-ant-1');
  assert.equal(c.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(c.body.model, HTTP_PROVIDERS.anthropic.defaultModel);
  assert.equal(c.body.system, SYSTEM_PROMPT);
  assert.deepEqual(c.body.messages, [{ role: 'user', content: 'P' }]);
  assert.ok(c.body.max_tokens >= 8000);
  assert.ok(!c.url.includes('sk-ant'), 'the key is never in the URL');
});

test('OpenAI: chat completions in JSON mode, bearer auth, max_completion_tokens', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  const r = await openai.invoke({ cfg: {}, prompt: 'P', env, model: 'gpt-x', fetch: f });
  assert.equal(r.code, 0);
  assert.equal(r.text, ANSWER);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer sk-oa-1');
  assert.equal(c.body.model, 'gpt-x');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.equal(c.body.messages[0].role, 'system');
  assert.equal(c.body.messages[0].content, SYSTEM_PROMPT);
  assert.equal(c.body.messages[1].content, 'P');
  assert.ok('max_completion_tokens' in c.body && !('max_tokens' in c.body));
});

test('Gemini: generateContent with the key as a header — never ?key= — and JSON output requested', async () => {
  const f = fakeFetch([ok({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] })]);
  const r = await gemini.invoke({ cfg: {}, prompt: 'P', env, model: 'gemini-z', fetch: f });
  assert.equal(r.code, 0);
  assert.equal(r.text, ANSWER);
  const c = f.calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-z:generateContent');
  assert.equal(c.headers['x-goog-api-key'], 'AIza-1');
  assert.ok(!c.url.includes('key='), 'the key is never a query parameter');
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(c.body.systemInstruction.parts[0].text, SYSTEM_PROMPT);
  assert.equal(c.body.contents[0].parts[0].text, 'P');
});

test('compatible: the configured base URL, max_tokens, and no Authorization header when there is no key', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'llama3', fetch: f });
  assert.equal(r.code, 0);
  const c = f.calls[0];
  assert.equal(c.url, 'http://ollama.lan:11434/v1/chat/completions');
  assert.equal(c.headers.authorization, undefined);
  assert.ok('max_tokens' in c.body && !('max_completion_tokens' in c.body));

  // …and with a key, it is sent.
  const g = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env, model: 'llama3', fetch: g });
  assert.equal(g.calls[0].headers.authorization, 'Bearer compat-1');
});

test('compatible: no endpoint configured, or no model chosen, is a clean failure rather than a request', async () => {
  const f = fakeFetch([]);
  const none = await compatible.invoke({ cfg: {}, prompt: 'P', env: {}, model: 'x', fetch: f });
  assert.equal(none.spawnError, true);
  const noModel = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: null, fetch: f });
  assert.equal(noModel.code, 1);
  assert.match(noModel.stderr, /no model/);
  assert.equal(f.calls.length, 0);
});

test('compatible: a server that rejects JSON mode gets the same request once more without it', async () => {
  const f = fakeFetch(n => n === 1
    ? { status: 400, body: { error: { message: 'response_format is not supported' } } }
    : ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] }));
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'llama3', fetch: f });
  assert.equal(r.code, 0);
  assert.equal(f.calls.length, 2);
  assert.ok('response_format' in f.calls[0].body);
  assert.ok(!('response_format' in f.calls[1].body));
});

test('a missing key is "missing", like an absent CLI — no request is made', async () => {
  const f = fakeFetch([]);
  const r = await anthropic.invoke({ cfg: {}, prompt: 'P', env: {}, fetch: f });
  assert.equal(r.spawnError, true);
  assert.equal(f.calls.length, 0);
  const cls = await attemptOnce({ adapter: anthropic, cfg: {}, kind: 'review', payload: { plan: { routines: [], week: {} } }, invokeOpts: { env: {}, fetch: f } }, null);
  assert.equal(cls.errorClass, 'missing');
});

test('401 and 403 reach the pipeline as "auth"; other statuses as "provider"', async () => {
  const payload = { plan: { routines: [], week: {} } };
  for (const [status, expect] of [[401, 'auth'], [403, 'auth'], [429, 'provider'], [500, 'provider']]) {
    const f = fakeFetch([{ status, body: { error: { message: 'nope' } } }]);
    const r = await openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f, retryDelayMs: 0 });
    assert.equal(r.code, 1);
    assert.ok(r.stderr.startsWith(String(status)), `stderr starts with the status: ${r.stderr}`);
    const cls = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: f, retryDelayMs: 0 } }, null);
    assert.equal(cls.errorClass, expect, `${status} → ${expect}`);
  }
});

test('a transient status (429, 5xx, 529) is retried twice with the same request, then given up on', async () => {
  const ok200 = ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  // Overloaded once, then fine: the job succeeds and the caller never hears about it.
  let f = fakeFetch([{ status: 529, body: { error: { message: 'overloaded' } } }, ok200]);
  let r = await openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f, retryDelayMs: 0 });
  assert.equal(r.code, 0);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].body, f.calls[1].body, 'the retry is the identical request');
  // Overloaded three times: two retries, then the status is the failure.
  f = fakeFetch([{ status: 503, body: { error: { message: 'busy' } } }]);
  r = await openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f, retryDelayMs: 0 });
  assert.equal(r.code, 1);
  assert.ok(r.stderr.startsWith('503'));
  assert.equal(f.calls.length, 3);
  // A 400 means the request is wrong; asking again would be asking the same wrong thing.
  f = fakeFetch([{ status: 400, body: { error: { message: 'bad model' } } }]);
  r = await anthropic.invoke({ cfg: {}, prompt: 'P', env, fetch: f, retryDelayMs: 0 });
  assert.equal(r.code, 1);
  assert.equal(f.calls.length, 1);
});

test('a body that is not JSON on an error still yields a readable stderr', async () => {
  const f = fakeFetch([{ status: 502, body: '<html>bad gateway</html>' }]);
  const r = await gemini.invoke({ cfg: {}, prompt: 'P', env, fetch: f });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^502 .*bad gateway/);
});

test('an answer cut off at the output limit fails as "provider", not as a half-parsed proposal', async () => {
  const cases = [
    [anthropic, ok({ content: [{ type: 'text', text: '{"coach_contract":1,"changes":[' }], stop_reason: 'max_tokens' })],
    [openai, ok({ choices: [{ message: { content: '{"coach_contract":1,"changes":[' }, finish_reason: 'length' }] })],
    [gemini, ok({ candidates: [{ content: { parts: [{ text: '{"coach_contract":1,' }] }, finishReason: 'MAX_TOKENS' }] })]
  ];
  for (const [adapter, answer] of cases) {
    const f = fakeFetch([answer]);
    const r = await adapter.invoke({ cfg: {}, prompt: 'P', env, model: 'm', fetch: f });
    assert.equal(r.code, 1, adapter.id);
    assert.match(r.stderr, /cut off/, adapter.id);
    const cls = await attemptOnce({ adapter, cfg: {}, kind: 'review', payload: { plan: { routines: [], week: {} } }, invokeOpts: { env, fetch: f } }, null);
    assert.equal(cls.errorClass, 'provider', adapter.id);
    assert.equal(cls.repairable, undefined, 'the repair round is not spent on a truncated answer');
  }
});

test('a refusal, and a Gemini safety stop, are provider errors with the reason in stderr', async () => {
  const a = fakeFetch([ok({ content: [], stop_reason: 'refusal', stop_details: { explanation: 'policy' } })]);
  const ra = await anthropic.invoke({ cfg: {}, prompt: 'P', env, fetch: a });
  assert.equal(ra.code, 1); assert.match(ra.stderr, /declined.*policy/);
  const g = fakeFetch([ok({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] })]);
  const rg = await gemini.invoke({ cfg: {}, prompt: 'P', env, fetch: g });
  assert.equal(rg.code, 1); assert.match(rg.stderr, /SAFETY/);
  const b = fakeFetch([ok({ promptFeedback: { blockReason: 'OTHER' } })]);
  const rb = await gemini.invoke({ cfg: {}, prompt: 'P', env, fetch: b });
  assert.equal(rb.code, 1); assert.match(rb.stderr, /blocked: OTHER/);
});

test('a fetch that throws names the host; an abort is a timeout', async () => {
  const boom = fakeFetch([Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' })]);
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'm', fetch: boom });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /could not reach ollama\.lan:11434/);

  // A fetch that only settles when the signal aborts — what a hung server looks like.
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t = await openai.invoke({ cfg: {}, prompt: 'P', env, timeoutMs: 20, fetch: hang });
  assert.equal(t.timedOut, true);
  const cls = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload: { plan: { routines: [], week: {} } }, timeoutMs: 20, invokeOpts: { env, fetch: hang } }, null);
  assert.equal(cls.errorClass, 'timeout');
});

test('models(): each list shape is read, sorted, and Gemini is filtered to generateContent', async () => {
  const oa = fakeFetch([ok({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] })]);
  assert.deepEqual((await openai.models({}, env, { fetch: oa })).models, ['gpt-a', 'gpt-b']);
  assert.equal(oa.calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(oa.calls[0].method, 'GET');

  const an = fakeFetch([ok({ data: [{ id: 'claude-z' }, { id: 'claude-a' }] })]);
  assert.deepEqual((await anthropic.models({}, env, { fetch: an })).models, ['claude-a', 'claude-z']);
  assert.equal(an.calls[0].headers['anthropic-version'], '2023-06-01');

  const ge = fakeFetch([ok({ models: [
    { name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }
  ] })]);
  assert.deepEqual((await gemini.models({}, env, { fetch: ge })).models, ['gemini-a', 'gemini-b']);
  assert.ok(ge.calls[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'));

  const bad = fakeFetch([{ status: 401, body: { error: { message: 'bad key' } } }]);
  const r = await openai.models({}, env, { fetch: bad });
  assert.equal(r.ok, false);
  assert.match(r.error, /^401 bad key/);
});

test('check(): without a key the runtime is ready and the key is what is missing; with one it lists models', async () => {
  const none = await anthropic.check({}, {}, { fetch: fakeFetch([]) });
  assert.equal(none.ok, true);
  assert.equal(none.needsKey, true);
  const f = fakeFetch([ok({ data: [{ id: 'claude-a' }] })]);
  const some = await anthropic.check({}, env, { fetch: f });
  assert.equal(some.ok, true);
  assert.match(some.version, /api\.anthropic\.com · 1 models/);
  const noBase = await compatible.check({}, {}, { fetch: fakeFetch([]) });
  assert.equal(noBase.ok, false);
});

test('validateBaseUrl: http(s) only, no credentials, no query, trailing slash dropped', () => {
  assert.deepEqual(validateBaseUrl('http://ollama.lan:11434/'), { ok: true, value: 'http://ollama.lan:11434' });
  assert.deepEqual(validateBaseUrl('  '), { ok: true, value: null });
  assert.equal(validateBaseUrl('ftp://x').ok, false);
  assert.equal(validateBaseUrl('http://user:pw@x').ok, false);
  assert.equal(validateBaseUrl('http://x/?key=1').ok, false);
  assert.equal(validateBaseUrl('not a url').ok, false);
});

test('models(): OpenAI’s list is cut to what Chat Completions can use; a compatible endpoint is not filtered', async () => {
  const { isChatModel } = await import('../coach/core/adapters/openai.js');
  const all = ['gpt-5.6', 'gpt-5.6-mini', 'gpt-4o', 'o3', 'o4-mini', 'chatgpt-4o-latest',
    'gpt-4o-realtime-preview', 'gpt-4o-audio-preview', 'gpt-4o-mini-tts', 'gpt-4o-transcribe', 'whisper-1',
    'text-embedding-3-small', 'gpt-image-1', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-search-preview',
    'gpt-3.5-turbo-instruct', 'codex-mini-latest', 'computer-use-preview', 'o3-deep-research', 'o1-pro', 'gpt-5.6-pro', 'davinci-002'];
  assert.deepEqual(all.filter(isChatModel), ['gpt-5.6', 'gpt-5.6-mini', 'gpt-4o', 'o3', 'o4-mini', 'chatgpt-4o-latest']);
  const oa = fakeFetch([ok({ data: all.map(id => ({ id })) })]);
  assert.deepEqual((await openai.models({}, env, { fetch: oa })).models, ['chatgpt-4o-latest', 'gpt-4o', 'gpt-5.6', 'gpt-5.6-mini', 'o3', 'o4-mini']);
  const stub = fakeFetch([ok({ data: [{ id: 'model-b' }, { id: 'model-a' }] })]);
  assert.deepEqual((await openai.models({}, env, { fetch: stub })).models, ['model-a', 'model-b'], 'a list with no recognisable chat model is served whole');
  const { default: compatible } = await import('../coach/core/adapters/compatible.js');
  const co = fakeFetch([ok({ data: [{ id: 'qwen2.5:3b' }, { id: 'llama3.2' }] })]);
  assert.deepEqual((await compatible.models({ providerOptions: { compatible: { baseUrl: 'http://ollama:11434' } } }, {}, { fetch: co })).models, ['llama3.2', 'qwen2.5:3b']);
});
