/* The AI/ML API provider: the request it puts on the wire, and the one thing that is ours
 * about it — attribution headers that ride only when the request is going to the gateway.
 *
 * The near-misses matter more than the hit: a partner id sent to a look-alike host is a leak,
 * and a partner id missing from a real request is revenue that counts for nobody. Upstream
 * reports neither, so these are the only place either is caught.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const aimlapi = (await import('../coach/core/adapters/aimlapi.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const { HTTP_PROVIDERS, baseUrlFor } = await import('../coach/core/providers.js');
const { AIMLAPI_PARTNER_ID, aimlapiHeaders, isAimlapiUrl } = await import('../coach/core/aimlapi-attribution.js');
const { SYSTEM_PROMPT } = await import('../coach/core/system-prompt.js');

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
const env = { AIMLAPI_API_KEY: 'aiml-1' };
const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';

test('AI/ML API is a described provider that spawns nothing', () => {
  assert.equal(aimlapi.spawns, false);
  assert.equal(aimlapi.needsRuntime, false);
  const meta = HTTP_PROVIDERS.aimlapi;
  assert.ok(meta, 'described in core/providers.js');
  assert.equal(meta.http, true);
  assert.equal(meta.apiKeyEnv, 'AIMLAPI_API_KEY');
  // A fixed endpoint, so no base URL field and no key-optional escape hatch.
  assert.equal(baseUrlFor('aimlapi', {}), 'https://api.aimlapi.com');
  assert.ok(!meta.baseUrl);
  assert.ok(!meta.keyOptional);
});

test('the chat request is Chat Completions with max_tokens and bearer auth', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  const r = await aimlapi.invoke({ cfg: {}, prompt: 'P', env, model: 'openai/gpt-6-luna', fetch: f });
  assert.equal(r.code, 0);
  assert.equal(r.text, ANSWER);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.aimlapi.com/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer aiml-1');
  assert.equal(c.body.model, 'openai/gpt-6-luna');
  assert.equal(c.body.messages[0].content, SYSTEM_PROMPT);
  // The gateway normalises for the models behind it; max_tokens is the field it accepts.
  assert.ok('max_tokens' in c.body && !('max_completion_tokens' in c.body));
  assert.ok(!c.url.includes('aiml-1'), 'the key is never in the URL');
});

test('attribution rides on the chat request and on the model list', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await aimlapi.invoke({ cfg: {}, prompt: 'P', env, model: 'openai/gpt-6-luna', fetch: f });
  const g = fakeFetch([ok({ data: [{ id: 'openai/gpt-6-luna' }] })]);
  await aimlapi.models({}, env, { fetch: g });

  for (const c of [f.calls[0], g.calls[0]]) {
    assert.equal(c.headers['x-aimlapi-source'], 'agent/opengym');
    assert.equal(c.headers['x-title'], 'openGym');
    assert.equal(c.headers['http-referer'], 'https://github.com/DuarteSantos8/openGym');
    // Minted by AI/ML API, and allowed to be cleared: an unknown id is accepted and dropped
    // upstream, so a placeholder would look exactly like one that works.
    if (AIMLAPI_PARTNER_ID) {
      assert.match(AIMLAPI_PARTNER_ID, /^part_[A-Za-z0-9]{1,64}$/);
      assert.equal(c.headers['x-aimlapi-partner-id'], AIMLAPI_PARTNER_ID);
    } else {
      assert.ok(!('x-aimlapi-partner-id' in c.headers));
    }
  }
});

test('no other provider carries the attribution headers', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await openai.invoke({ cfg: {}, prompt: 'P', env: { OPENAI_API_KEY: 'sk-oa-1' }, model: 'gpt-x', fetch: f });
  for (const name of ['x-aimlapi-source', 'x-aimlapi-partner-id', 'x-title', 'http-referer']) {
    assert.ok(!(name in f.calls[0].headers), `${name} leaked to OpenAI`);
  }
});

test('the host gate is an equality test, not a prefix', () => {
  for (const url of ['https://api.aimlapi.com', 'https://api.aimlapi.com/v1', 'https://API.AIMLAPI.COM/v1']) {
    assert.equal(isAimlapiUrl(url), true, url);
    assert.ok(Object.keys(aimlapiHeaders(url)).length > 0, url);
  }
  for (const url of [
    'https://api.aimlapi.com.example.net/v1',   // the case the equality test exists for
    'https://notapi.aimlapi.com/v1',
    'https://aimlapi.com/v1',
    'https://openrouter.ai/api/v1',
    'http://ollama.lan:11434/v1',
    'api.aimlapi.com/v1',                        // no scheme: not a URL we will call
    '', null, undefined
  ]) {
    assert.equal(isAimlapiUrl(url), false, String(url));
    assert.deepEqual(aimlapiHeaders(url), {});
  }
});

test('a configured base URL takes attribution with it', async () => {
  // Nothing offers this field for a fixed-endpoint provider, but config can still carry it,
  // and the partner id must follow the address rather than the provider name.
  const cfg = { provider: 'aimlapi', providerOptions: { aimlapi: { baseUrl: 'https://proxy.example.com/v1' } } };
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  await aimlapi.invoke({ cfg, prompt: 'P', env, model: 'openai/gpt-6-luna', fetch: f });
  assert.equal(f.calls[0].url, 'https://proxy.example.com/v1/v1/chat/completions');
  assert.ok(!('x-aimlapi-source' in f.calls[0].headers), 'attribution followed the host, not the id');
});

test('the model list keeps chat rows and drops the rest', async () => {
  // The shape the gateway actually answers: one row per endpoint family, type the only signal.
  const f = fakeFetch([ok({ data: [
    { id: 'openai/gpt-6-luna', type: 'openai/chat-completions' },
    { id: 'openai/gpt-6-luna', type: 'openai/responses/submit' },   // same model, second surface
    { id: 'anthropic/claude-sonnet-5.5', type: 'anthropic/messages' },
    { id: 'openai/gpt-image-2', type: 'openai/image-generations' },
    { id: 'elevenlabs/eleven_v4', type: 'internal/text-to-speech' },
    { id: 'openai/text-embedding-3-large', type: 'openai/embeddings' },
    { id: 'future/unknown-family', type: 'openai/something-new' },
    { id: 'legacy/no-type-field' }
  ] })]);
  const r = await aimlapi.models({}, env, { fetch: f });
  assert.equal(r.ok, true);
  // The transport sorts what a spec returns, so assert the set rather than the order.
  assert.deepEqual(r.models, ['anthropic/claude-sonnet-5.5', 'legacy/no-type-field', 'openai/gpt-6-luna']);
});

test('a list with no recognised chat row is offered whole rather than empty', async () => {
  const f = fakeFetch([ok({ data: [{ id: 'a', type: 'internal/text-to-speech' }, { id: 'b', type: 'openai/embeddings' }] })]);
  const r = await aimlapi.models({}, env, { fetch: f });
  assert.deepEqual(r.models, ['a', 'b']);
});
