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
const { HTTP_PROVIDERS, validateBaseUrl, validateHeaders } = await import('../coach/core/providers.js');
const { modelSubstitute } = await import('../coach/core/adapters/http.js');
const { SYSTEM_PROMPT } = await import('../coach/core/system-prompt.js');
const { REVIEW_SCHEMA } = await import('../coach/core/schemas.js');

/** A fetch that records what it was asked and answers from a script. Like the real one, it
 *  refuses an already-aborted signal without putting anything on the wire. */
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

test('compatible: a base that already names its API version is used as the full prefix (#437)', async () => {
  const answer = ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  const at = baseUrl => ({ provider: 'compatible', providerOptions: { compatible: { baseUrl } } });
  const cases = [
    // Zhipu GLM serves Chat Completions only under v4; there is no /v1 alias.
    ['https://open.bigmodel.cn/api/coding/paas/v4', 'https://open.bigmodel.cn/api/coding/paas/v4'],
    // OpenRouter, Groq and most gateways document their base with /v1 on it.
    ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1'],
    // Gemini's OpenAI-compatible endpoint has its version mid-path.
    ['https://generativelanguage.googleapis.com/v1beta/openai/', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    // A bare host keeps getting /v1, as before.
    ['http://ollama.lan:11434', 'http://ollama.lan:11434/v1'],
    // A version-looking word that is not a version segment is left alone.
    ['http://gw.lan/v2ray', 'http://gw.lan/v2ray/v1']
  ];
  for (const [base, prefix] of cases) {
    const f = fakeFetch([answer]);
    await compatible.invoke({ cfg: at(base), prompt: 'P', env: {}, model: 'm', fetch: f });
    assert.equal(f.calls[0].url, prefix + '/chat/completions', base);
    const m = fakeFetch([ok({ data: [] })]);
    await compatible.models(at(base), {}, { fetch: m });
    assert.equal(m.calls[0].url, prefix + '/models', base);
  }
});

test('compatible: a mount whose API has no version segment is reached on the 404 fallback and remembered (#508)', async () => {
  // The issue's repro: an OpenAI-shaped mount (Open WebUI's /openai) that 404s anything with /v1.
  const { createServer } = await import('node:http');
  const hits = [];
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    hits.push(req.method + ' ' + url);
    const send = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/openai/models') return send(200, { object: 'list', data: [{ id: 'a-local-model', object: 'model' }] });
    if (url === '/openai/chat/completions' && req.method === 'POST') {
      req.resume();
      return req.on('end', () => send(200, { object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }] }));
    }
    req.resume();
    return send(404, { detail: 'Not Found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/openai`;
    const cfg = { provider: 'compatible', providerOptions: { compatible: { baseUrl: validateBaseUrl(base).value } } };
    const m = await compatible.models(cfg, env);
    assert.deepEqual(m, { ok: true, models: ['a-local-model'] });
    const r = await compatible.invoke({ cfg, env, model: 'a-local-model', prompt: 'ping', maxTokens: 64 });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.text, ANSWER);
    // The first call of all tried /v1, every later one went straight to the form that answered.
    assert.deepEqual(hits, ['GET /openai/v1/models', 'GET /openai/models', 'POST /openai/chat/completions']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('compatible: the 404 fallback keeps the first error when neither form answers, and never touches other providers (#508)', async () => {
  // Ollama answers an unknown model with a 404 of its own; that message must survive the retry.
  const f = fakeFetch(n => (n === 1
    ? { status: 404, body: { error: { message: 'model "nope" not found, try pulling it first' } } }
    : { status: 404, body: '404 page not found' }));
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'nope', fetch: f });
  assert.deepEqual(f.calls.slice(0, 2).map(c => c.url), ['http://ollama.lan:11434/v1/chat/completions', 'http://ollama.lan:11434/chat/completions']);
  assert.equal(r.code, 1);
  // (then the model fallback asks for the list, which this endpoint cannot give: #758)
  assert.match(r.stderr, /^404 the model "nope" is not available to this key: model "nope" not found/);
  // …and a failed fallback teaches nothing: the next request still starts at /v1.
  const g = fakeFetch([ok({ data: [] })]);
  await compatible.models(cfgCompat, {}, { fetch: g });
  assert.equal(g.calls[0].url, 'http://ollama.lan:11434/v1/models');

  // A base that carries its version has only one form, so a 404 there is final.
  const v = fakeFetch([{ status: 404, body: { error: 'nope' } }]);
  await compatible.invoke({ cfg: { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'https://openrouter.ai/api/v1' } } }, prompt: 'P', env: {}, model: 'm', fetch: v });
  assert.equal(v.calls.length, 1);

  // OpenAI itself always lives at /v1; a 404 there is a real answer, not a missing prefix.
  const o = fakeFetch([{ status: 404, body: { error: { message: 'The model `x` does not exist' } } }]);
  const ro = await openai.invoke({ cfg: {}, prompt: 'P', env, model: 'x', fetch: o });
  assert.ok(o.calls.every(c => c.url.startsWith('https://api.openai.com/v1/')), 'never the bare form');
  assert.match(ro.stderr, /^404 the model "x" is not available to this key \(and neither is "gpt-[^"]+"\): The model/);
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

// OpenRouter in front of Gemini, as it really answers a schema Gemini cannot serve: the
// provider's words are only in metadata.raw (JSON in a string), the outer message is generic.
const openRouterWrapped = providerMessage => ({
  status: 400,
  body: { error: { message: 'Provider returned error', code: 400, metadata: {
    raw: JSON.stringify({ error: { code: 400, message: providerMessage, status: 'INVALID_ARGUMENT' } }),
    provider_name: 'Google AI Studio'
  } } }
});

test('compatible: a schema the provider cannot serve, wrapped by OpenRouter, is retried once in plain JSON mode', async () => {
  const f = fakeFetch(n => n === 1
    ? openRouterWrapped('The specified schema produces a constraint that has too many states for serving.')
    : ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] }));
  const schema = { type: 'object', properties: { coach_contract: { type: 'integer' } } };
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', schema, env: {}, model: 'google/gemini-2.5-flash-lite', fetch: f });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.response_format.type, 'json_schema');
  assert.deepEqual(f.calls[1].body.response_format, { type: 'json_object' });
});

test('a provider error wrapped by OpenRouter reaches stderr in the provider’s own words', async () => {
  const f = fakeFetch([openRouterWrapped('Request contains an invalid argument: temperature out of range.')]);
  const r = await openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f });
  assert.equal(r.code, 1);
  assert.equal(f.calls.length, 1, 'not a JSON-mode problem, so no second request');
  assert.ok(r.stderr.includes('Provider returned error'), r.stderr);
  assert.ok(r.stderr.includes('temperature out of range'), r.stderr);
});

test('a wrapped provider error that mentions tokens is still "provider", not "auth"', async () => {
  const f = fakeFetch([openRouterWrapped('The input token count exceeds the maximum number of tokens allowed.')]);
  const payload = { plan: { routines: [], week: {} } };
  const cls = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: f } }, null);
  assert.equal(cls.errorClass, 'provider', cls.detail);
  assert.ok(cls.detail.includes('token count'), cls.detail);
});

test('a wrapped provider error whose raw text is not JSON is passed through as it is', async () => {
  const f = fakeFetch([{ status: 400, body: { error: { message: 'Provider returned error', metadata: { raw: 'upstream said no' } } } }]);
  const r = await openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f });
  assert.ok(r.stderr.includes('upstream said no'), r.stderr);
});

test('a validator that rejects the flat schema on additionalProperties gets one strict copy of the same request (#701)', async () => {
  const f = fakeFetch(n => n === 1
    ? { status: 400, body: { error: { type: 'invalid_request_error', message: "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false" } } }
    : ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] }));
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'anthropic/claude-haiku', schema: REVIEW_SCHEMA, fetch: f });
  assert.equal(r.code, 0);
  assert.equal(f.calls.length, 2);
  const first = f.calls[0].body.response_format.json_schema.schema;
  const second = f.calls[1].body.response_format.json_schema.schema;
  // the strict copy says what the validator asked for, at every level it walks
  assert.equal(first.additionalProperties, undefined);
  assert.equal(second.additionalProperties, false);
  assert.equal(second.properties.evidence.additionalProperties, false);
  assert.equal(second.properties.changes.items.additionalProperties, false);
  assert.equal(second.properties.changes.items.properties.target.additionalProperties, false);
  // union types that can be an object say it too, so the walker has no gap to trip on
  assert.equal(second.properties.changes.items.properties.before.additionalProperties, false);
  // nothing else about the request moved — the added marker is the only difference at
  // the top level — and the flat schema the grammar converters need is still the one
  // stored in schemas.js
  assert.deepEqual(Object.keys(second), [...Object.keys(first), 'additionalProperties']);
  assert.equal(second.type, first.type);
  assert.deepEqual(second.required, first.required);
  assert.deepEqual(Object.keys(second.properties), Object.keys(first.properties));
  assert.equal(f.calls[1].body.model, f.calls[0].body.model);
  assert.deepEqual(f.calls[1].body.messages, f.calls[0].body.messages);
  assert.equal(REVIEW_SCHEMA.additionalProperties, undefined);
  assert.equal(REVIEW_SCHEMA.properties.evidence.additionalProperties, undefined);
});

test('a validator that rejects the strict copy as well still falls back to plain JSON mode', async () => {
  const f = fakeFetch(n => n === 1
    ? { status: 400, body: { error: { message: "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false" } } }
    : n === 2
      ? { status: 400, body: { error: { message: 'response_format is not supported' } } }
      : ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] }));
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'anthropic/claude-haiku', schema: REVIEW_SCHEMA, fetch: f });
  assert.equal(r.code, 0);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].body.response_format.type, 'json_schema');
  assert.equal(f.calls[1].body.response_format.type, 'json_schema');
  assert.equal(f.calls[1].body.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(f.calls[2].body.response_format, { type: 'json_object' });
});

test('an additionalProperties complaint about a request with no schema never invents a strict schema', async () => {
  const f = fakeFetch([{ status: 400, body: { error: { message: "output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false" } } }]);
  const r = await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'anthropic/claude-haiku', fetch: f });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^400 /);
  // the plain-JSON fallback may still drop JSON mode once; a json_schema never goes out
  assert.ok(f.calls.every(c => !c.body.response_format || c.body.response_format.type !== 'json_schema'));
  assert.ok(f.calls.length <= 2);
});

// Gemini as it answers a key made after a model was retired for new users (#758).
const GEMINI_GONE = { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use models/gemini-3.1-pro-preview for the latest features and improvements.' } } };
const geminiList = names => ok({ models: names.map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
const geminiAnswer = ok({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] });
const geminiAt = host => ({ provider: 'gemini', providerOptions: { gemini: { baseUrl: `https://${host}` } } });

test('Gemini: the default is a current model, not one Google refuses new keys (#758)', () => {
  assert.doesNotMatch(HTTP_PROVIDERS.gemini.defaultModel, /^gemini-(1|2)\./);
});

test('a model the key cannot use is swapped once for the provider default it lists, and remembered (#758)', async () => {
  const cfg = geminiAt('g1.test');
  const f = fakeFetch((n, url) => url.includes('/models?') ? geminiList(['gemini-2.5-pro', 'gemini-embedding-001', HTTP_PROVIDERS.gemini.defaultModel])
    : url.includes('gemini-2.5-pro') ? GEMINI_GONE : geminiAnswer);
  const r = await gemini.invoke({ cfg, prompt: 'P', env, model: 'gemini-2.5-pro', fetch: f });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.model, HTTP_PROVIDERS.gemini.defaultModel);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[2].url.includes(`/models/${HTTP_PROVIDERS.gemini.defaultModel}:generateContent`), f.calls[2].url);
  assert.equal(modelSubstitute('gemini', cfg, 'gemini-2.5-pro'), HTTP_PROVIDERS.gemini.defaultModel);
  // the repair round and the next job go straight to the model that answered
  const g = fakeFetch(() => geminiAnswer);
  const again = await gemini.invoke({ cfg, prompt: 'P', env, model: 'gemini-2.5-pro', fetch: g });
  assert.equal(again.code, 0);
  assert.equal(g.calls.length, 1);
  assert.ok(g.calls[0].url.includes(HTTP_PROVIDERS.gemini.defaultModel));
});

test('without the default in the list, the newest plain Flash the key lists is the one tried (#758)', async () => {
  const f = fakeFetch((n, url) => url.includes('/models?')
    ? geminiList(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.8-flash-tts', 'gemini-3.5-flash-lite'])
    : url.includes('gemini-2.5-pro') ? GEMINI_GONE : geminiAnswer);
  const r = await gemini.invoke({ cfg: geminiAt('g2.test'), prompt: 'P', env, model: 'gemini-2.5-pro', fetch: f });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.model, 'gemini-3.6-flash');
});

test('when no other model works either, the error names the model and says where to change it (#758)', async () => {
  const f = fakeFetch((n, url) => url.includes('/models?') ? geminiList(['gemini-2.5-pro', 'gemini-embedding-001']) : GEMINI_GONE);
  const r = await gemini.invoke({ cfg: geminiAt('g3.test'), prompt: 'P', env, model: 'gemini-2.5-pro', fetch: f });
  assert.equal(r.code, 1);
  assert.equal(f.calls.length, 2, 'the list had nothing else to try, so no second job request');
  assert.match(r.stderr, /^404 the model "gemini-2\.5-pro" is not available to this key: This model models\/gemini-2\.5-pro is no longer available/);
  assert.match(r.stderr, /Coach settings/);
  const payload = { plan: { routines: [], week: {} } };
  const cls = await attemptOnce({ adapter: gemini, cfg: geminiAt('g3.test'), kind: 'review', payload, model: 'gemini-2.5-pro', invokeOpts: { env, fetch: f } }, null);
  assert.equal(cls.errorClass, 'provider');
});

test('the swap is one try: a substitute that is refused as well ends the job, naming it (#758)', async () => {
  const f = fakeFetch((n, url) => url.endsWith('/v1/models') ? ok({ data: [{ id: 'claude-old' }, { id: 'claude-older' }] })
    : { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model: whatever' } } });
  const r = await anthropic.invoke({ cfg: { providerOptions: { anthropic: { baseUrl: 'https://a1.test' } } }, prompt: 'P', env, model: 'claude-old', fetch: f });
  assert.equal(r.code, 1);
  const posts = f.calls.filter(c => c.method === 'POST');
  assert.deepEqual(posts.map(c => c.body.model), ['claude-old', 'claude-older']);
  assert.match(r.stderr, /^404 the model "claude-old" is not available to this key \(and neither is "claude-older"\)/);
});

test('a 400 that names an unknown model (OpenRouter) is a model problem too; other 400s are not (#758)', async () => {
  const cfg = { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'https://openrouter.test/api/v1' } } };
  const f = fakeFetch((n, url, init) => init.method === 'GET' ? ok({ data: [{ id: 'anthropic/claude-x' }, { id: 'google/gemini-3.8-flash' }, { id: 'openai/gpt-x' }] })
    : JSON.parse(init.body).model === 'google/gemini-2.5-pro' ? { status: 400, body: { error: { message: 'google/gemini-2.5-pro is not a valid model ID' } } }
      : ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] }));
  const r = await compatible.invoke({ cfg, prompt: 'P', env: {}, model: 'google/gemini-2.5-pro', fetch: f });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.model, 'google/gemini-3.8-flash', 'the same vendor as the refused name');
  const h = fakeFetch([{ status: 400, body: { error: { message: 'temperature must be between 0 and 2' } } }]);
  const rh = await openai.invoke({ cfg: {}, prompt: 'P', env, model: 'gpt-x', fetch: h });
  assert.equal(h.calls.length, 1);
  assert.match(rh.stderr, /^400 temperature/);
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

test('an abort that lands during a retry pause sends nothing more and ends as a timeout', async () => {
  // A forget mid-backoff: the payload must not go out a second time, and the job must drain
  // now rather than wait for the next attempt to time out.
  const ac = new AbortController();
  const f = fakeFetch([{ status: 429, body: { error: { message: 'slow down' } } }]);
  const p = openai.invoke({ cfg: {}, prompt: 'P', env, fetch: f, signal: ac.signal, retryDelayMs: 10000 });
  await new Promise(r => setTimeout(r, 20));      // the first 429 is back and the pause has begun
  ac.abort();
  const r = await p;
  assert.equal(f.calls.length, 1, 'the payload is not sent again');
  assert.equal(r.timedOut, true);
});

test('a body that is not JSON on an error yields its status, never the body itself', async () => {
  const f = fakeFetch([{ status: 502, body: '<html>bad gateway</html>' }]);
  const r = await gemini.invoke({ cfg: {}, prompt: 'P', env, fetch: f });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^502 \(the endpoint sent no error message\)$/);
  // The model list too: an admin pointing a compatible endpoint at a page inside the network
  // learns the status, not the page.
  const g = fakeFetch([{ status: 403, body: 'router admin: secret-ssid' }, { status: 403, body: 'router admin: secret-ssid' }]);
  const m = await compatible.models(cfgCompat, {}, { fetch: g });
  assert.equal(m.ok, false);
  assert.doesNotMatch(m.error, /secret/);
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

test('check(): the Runtime line names the scheme the endpoint is really called with', async () => {
  const lan = await compatible.check(cfgCompat, env, { fetch: fakeFetch([ok({ data: [{ id: 'llama' }] })]) });
  assert.equal(lan.ok, true);
  assert.match(lan.version, /^HTTP · ollama\.lan:11434 · 1 models$/);
  const lanNoKey = await compatible.check(cfgCompat, {}, { fetch: fakeFetch([ok({ data: [] })]) });
  assert.match(lanNoKey.version, /^HTTP · /);
  const cloud = await anthropic.check({}, env, { fetch: fakeFetch([ok({ data: [{ id: 'claude-a' }] })]) });
  assert.match(cloud.version, /^HTTPS · api\.anthropic\.com/);
  const cloudNoKey = await openai.check({}, {}, { fetch: fakeFetch([]) });
  assert.match(cloudNoKey.version, /^HTTPS · api\.openai\.com$/);
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

test('invoke sends the configured maxTokens override, and the adapter default when none is given', async () => {
  const { MAX_OUTPUT_TOKENS } = await import('../coach/core/adapters/http.js');

  // No override: every caller that configures nothing (the phone, warmup) still gets the default.
  const d = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await compatible.invoke({ cfg: cfgCompat, prompt: 'P', env: {}, model: 'm', fetch: d });
  assert.equal(d.calls[0].body.max_tokens, MAX_OUTPUT_TOKENS);

  // An override, on each wire shape that carries the ceiling.
  const o = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await openai.invoke({ cfg: {}, prompt: 'P', env, model: 'gpt-x', fetch: o, maxTokens: 48000 });
  assert.equal(o.calls[0].body.max_completion_tokens, 48000);

  const a = fakeFetch([ok({ content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn' })]);
  await anthropic.invoke({ cfg: {}, prompt: 'P', env, fetch: a, maxTokens: 48000 });
  assert.equal(a.calls[0].body.max_tokens, 48000);

  const g = fakeFetch([ok({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] })]);
  await gemini.invoke({ cfg: {}, prompt: 'P', env, model: 'gemini-z', fetch: g, maxTokens: 48000 });
  assert.equal(g.calls[0].body.generationConfig.maxOutputTokens, 48000);
});

test('compatible: configured extra headers ride on models, check and jobs — auth framing always wins', async () => {
  const cfg = { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://ollama.lan:11434', headers: { 'x-opencode-session': 'sess-1' } } } };
  const m = fakeFetch([ok({ data: [] })]);
  await compatible.models(cfg, env, { fetch: m });
  assert.equal(m.calls[0].headers['x-opencode-session'], 'sess-1');
  assert.equal(m.calls[0].headers.authorization, 'Bearer compat-1');
  const j = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await compatible.invoke({ cfg, prompt: 'P', env, model: 'llama3', fetch: j });
  assert.equal(j.calls[0].headers['x-opencode-session'], 'sess-1');

  // A stored map from before a name was reserved must not override auth framing.
  const evil = { provider: 'compatible', providerOptions: { compatible: { baseUrl: 'http://x', headers: { authorization: 'Bearer evil', 'content-type': 'text/plain' } } } };
  const e = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await compatible.invoke({ cfg: evil, prompt: 'P', env, model: 'llama3', fetch: e });
  assert.equal(e.calls[0].headers.authorization, 'Bearer compat-1');
  assert.equal(e.calls[0].headers['content-type'], 'application/json');
});

test('validateHeaders: small maps pass, framing names and junk do not', () => {
  assert.deepEqual(validateHeaders(null).value, null);
  assert.deepEqual(validateHeaders({}).value, null);
  assert.deepEqual(validateHeaders({ 'X-Opencode-Session': ' abc ' }).value, { 'x-opencode-session': 'abc' });
  for (const bad of ['authorization', 'Content-Type', 'content-length', 'Host', 'cookie']) {
    assert.equal(validateHeaders({ [bad]: 'x' }).ok, false, bad);
  }
  assert.equal(validateHeaders({ 'not a name!': 'x' }).ok, false);
  assert.equal(validateHeaders({ a: '' }).ok, false);
  assert.equal(validateHeaders('x-opencode-session: abc').ok, false);
  assert.equal(validateHeaders([['a', 'b']]).ok, false);
  const many = {}; for (let i = 0; i < 9; i++) many['x-h-' + i] = 'v';
  assert.equal(validateHeaders(many).ok, false);
});
