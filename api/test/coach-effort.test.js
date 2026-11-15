/* The thinking level on every provider (#1240).

 * COACH_EFFORT was read by the Claude Agent SDK adapter alone, because that is the one place
 * openGym knows the level set for certain. Every other provider has its own word for the same
 * idea and its own set of levels, so one setting needs one mapping per provider plus the
 * compatibility ladder behind it: a model that refuses the field, or the value, is answered with
 * a request without it rather than with a failed job.
 *
 * What is asserted here: each provider's request carries the level under its own field name and
 * clamped to its own vocabulary; nothing is sent when the setting is unset (so an instance that
 * never touched it sees exactly the requests it sends today); and an endpoint that refuses the
 * field still answers on the next attempt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();

const { EFFORTS, effortFrom, clampEffort } = await import('../coach/core/adapters/effort.js');
const { anthropicSpec } = await import('../coach/core/adapters/anthropic.js');
const { geminiSpec } = await import('../coach/core/adapters/gemini.js');
const { openrouterSpec } = await import('../coach/core/adapters/openrouter.js');
const { compatibleSpec } = await import('../coach/core/adapters/compatible.js');
const { minimaxSpec } = await import('../coach/core/adapters/minimax.js');
const { chatCompletionsSpec } = await import('../coach/core/adapters/openai.js');
const openai = (await import('../coach/core/adapters/openai.js')).default;
const anthropic = (await import('../coach/core/adapters/anthropic.js')).default;
const gemini = (await import('../coach/core/adapters/gemini.js')).default;
const { COMPAT_STEPS } = await import('../coach/core/adapters/http.js');

const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

// What a spec puts on the wire for one level: the request, with the level applied the way
// http.js applies it.
const sent = (spec, level) => {
  const b = spec.body({ model: 'm', prompt: 'P', system: null, schema: null, maxTokens: 16000, base: 'https://x.test' });
  return spec.withEffort && level ? spec.withEffort(b, level) : b;
};

/* ---------- the setting itself ---------- */

test('the level set is the Claude Agent SDK vocabulary, and an unknown value sends nothing', () => {
  assert.deepEqual([...EFFORTS], ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const level of EFFORTS) assert.equal(effortFrom({ COACH_EFFORT: level }), level);
  assert.equal(effortFrom({ COACH_EFFORT: ' High ' }), 'high', 'padded and cased the way a person types it');
  assert.equal(effortFrom({ COACH_EFFORT: 'hihg' }), undefined, 'a typo is not a level');
  assert.equal(effortFrom({}), undefined);
});

test('a level a provider does not have is clamped to its highest, never dropped or invented', () => {
  const OPENAI = ['minimal', 'low', 'medium', 'high'];
  assert.equal(clampEffort(OPENAI, 'xhigh'), 'high');
  assert.equal(clampEffort(OPENAI, 'max'), 'high');
  assert.equal(clampEffort(OPENAI, 'low'), 'low', 'a level it has is passed through untouched');
  assert.equal(clampEffort(EFFORTS, 'max'), 'max');
});

/* ---------- what each provider is asked for ---------- */

test('each provider carries the level in its own field', () => {
  assert.equal(sent(chatCompletionsSpec('openai'), 'high').reasoning_effort, 'high');
  assert.equal(sent(compatibleSpec, 'high').reasoning_effort, 'high');
  assert.equal(sent(minimaxSpec, 'high').reasoning_effort, 'high');
  assert.deepEqual(sent(openrouterSpec, 'high').reasoning, { effort: 'high' });
  assert.deepEqual(sent(anthropicSpec, 'high').output_config, { effort: 'high' });
  assert.deepEqual(sent(geminiSpec, 'high').generationConfig.thinkingConfig, { thinkingLevel: 'high' });
});

test('a level is clamped to what each provider offers', () => {
  assert.equal(sent(chatCompletionsSpec('openai'), 'max').reasoning_effort, 'high', 'OpenAI has no max');
  assert.equal(sent(geminiSpec, 'xhigh').generationConfig.thinkingConfig.thinkingLevel, 'high', 'Gemini has no xhigh');
  assert.equal(sent(minimaxSpec, 'max').reasoning_effort, 'max', 'MiniMax has the whole ladder');
  assert.equal(sent(anthropicSpec, 'max').output_config.effort, 'max');
  assert.equal(sent(openrouterSpec, 'max').reasoning.effort, 'max', 'OpenRouter normalises for the routed model');
  assert.equal(sent(compatibleSpec, 'max').reasoning_effort, 'max', 'a gateway that does not know it is the ladder to catch');
});

test('nothing is sent when the instance set no level', () => {
  for (const spec of [chatCompletionsSpec('openai'), compatibleSpec, minimaxSpec, openrouterSpec, anthropicSpec, geminiSpec]) {
    const b = sent(spec, undefined);
    assert.ok(!('reasoning_effort' in b), `${spec.id}: no reasoning_effort`);
    assert.ok(!('output_config' in b), `${spec.id}: no output_config`);
    assert.ok(!('reasoning' in b), `${spec.id}: no reasoning`);
    const tc = b.generationConfig && b.generationConfig.thinkingConfig;
    assert.ok(!tc, `${spec.id}: no thinkingConfig`);
  }
});

test('the level does not disturb anything else in the request', () => {
  const plain = sent(compatibleSpec, undefined);
  const withLevel = sent(compatibleSpec, 'high');
  const { reasoning_effort: _e, ...rest } = withLevel;
  assert.deepEqual(rest, plain);
});

/* ---------- the request that actually leaves ---------- */

let n = 0;
const at = () => ({ provider: 'compatible', providerOptions: { compatible: { baseUrl: `https://eff${++n}.test/v1` } } });
const ask = (adapter, cfg, f, extra = {}) => adapter.invoke({
  cfg, prompt: 'P', system: 'S', schema: null, env: { COACH_EFFORT: 'high' }, model: 'gpt-6.1-sol',
  fetch: f, stream: false, ...extra
});

test('a gateway that refuses the level field is answered without it (#1240)', async () => {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if ('reasoning_effort' in body) {
      return reply(400, { error: { message: "Unsupported parameter: 'reasoning_effort' is not supported" } });
    }
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  const r = await ask((await import('../coach/core/adapters/compatible.js')).default, at(), f);
  assert.equal(r.code, 0, r.stderr);
  assert.equal('reasoning_effort' in calls[0], true, 'it was asked for first');
  assert.equal('reasoning_effort' in calls.at(-1), false, 'and given up on once refused');
});

test('a gateway that takes the field but refuses the value is answered without the level', async () => {
  // llama.cpp validates the enum: a value it does not define comes back as a literal_error
  // naming the field. The ladder gives the level up rather than walking it down one step at a
  // time, so the job runs on the model's own thinking instead of failing.
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.reasoning_effort === 'max') {
      return reply(400, { error: { message: "1 validation error:\n  {'type': 'literal_error', 'loc': 'body.reasoning_effort'}" } });
    }
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  const r = await ask((await import('../coach/core/adapters/compatible.js')).default, at(), f, { env: { COACH_EFFORT: 'max' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(calls.length, 2, 'asked, refused, asked again');
  assert.equal(calls[0].reasoning_effort, 'max');
  assert.equal('reasoning_effort' in calls[1], false, 'the level was given up, not argued with');
});

test('an endpoint that refuses everything the level needs still answers', async () => {
  // A generic 400 that names nothing: the ladder walks, and the level is one of the things it
  // can give up. Nothing here may end in a failed job.
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if ('reasoning_effort' in body || 'response_format' in body) {
      return reply(400, { error: { message: 'The request could not be processed. Please check the request parameters.' } });
    }
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  const r = await ask((await import('../coach/core/adapters/compatible.js')).default, at(), f);
  assert.equal(r.code, 0, r.stderr);
  assert.equal('reasoning_effort' in calls.at(-1), false);
});

test('an unset level sends exactly the request this adapter sent before', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  const cfg = at();
  const r = await ask((await import('../coach/core/adapters/compatible.js')).default, cfg, f, { env: {} });
  assert.equal(r.code, 0, r.stderr);
  assert.equal('reasoning_effort' in calls[0], false);
});

/* ---------- the hosted APIs, over the wire ---------- */

test('Anthropic and Gemini carry the level in their own shape on the wire', async () => {
  const seen = {};
  const ok = body => async (url, init) => {
    seen[body] = JSON.parse(init.body);
    return reply(200, body === 'anthropic'
      ? { content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn' }
      : { candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] });
  };
  const a = await anthropic.invoke({ cfg: { provider: 'anthropic' }, prompt: 'P', env: { ANTHROPIC_API_KEY: 'k', COACH_EFFORT: 'xhigh' }, model: 'claude-x', fetch: ok('anthropic'), stream: false });
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(seen.anthropic.output_config, { effort: 'xhigh' });

  const g = await gemini.invoke({ cfg: { provider: 'gemini' }, prompt: 'P', env: { GEMINI_API_KEY: 'k', COACH_EFFORT: 'max' }, model: 'gemini-3', fetch: ok('gemini'), stream: false });
  assert.equal(g.code, 0, g.stderr);
  assert.deepEqual(seen.gemini.generationConfig.thinkingConfig, { thinkingLevel: 'high' }, 'Gemini has no max, so it gets its highest');
});

test('OpenAI refuses a non-reasoning model and the job still runs', async () => {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if ('reasoning_effort' in body) return reply(400, { error: { message: "Unsupported value: 'reasoning_effort' does not support 'high' with this model." } });
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  const r = await openai.invoke({ cfg: { provider: 'openai' }, prompt: 'P', env: { OPENAI_API_KEY: 'k', COACH_EFFORT: 'high' }, model: 'gpt-4o', fetch: f, stream: false });
  assert.equal(r.code, 0, r.stderr);
  assert.equal('reasoning_effort' in calls.at(-1), false);
});

/* ---------- what the ladder may give up ---------- */

test('the level is a rung of the compatibility ladder, given up before JSON mode', () => {
  assert.ok(COMPAT_STEPS.includes('effort'), 'a refused level must be droppable');
  assert.ok(COMPAT_STEPS.indexOf('effort') < COMPAT_STEPS.indexOf('plain'),
    'losing the level is cheaper than losing the JSON contract');
});

test('a spec with only some rungs survives a 400 naming one it does not have', async () => {
  // anthropic and gemini carry an `effort` rung and nothing else, because the other rungs are
  // Chat Completions shapes they never send. A 400 that names one of those must not be answered
  // by calling a step that does not exist; the provider's own words are the answer.
  const f = async () => reply(400, { error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } });
  const r = await anthropic.invoke({ cfg: { provider: 'anthropic' }, prompt: 'P', env: { ANTHROPIC_API_KEY: 'k' }, model: 'claude-x', fetch: f, stream: false });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /temperature/, 'the provider\'s own words, not a crash');
});

test('OpenAI web research asks the Responses API in its own field, not the chat one', async () => {
  // openaiWebSpec spreads openaiSpec, so it would inherit the Chat Completions hook and put a
  // top-level reasoning_effort on a /v1/responses request that only knows reasoning.effort.
  const calls = [];
  const urls = [];
  const f = async (url, init) => {
    urls.push(url.replace(/^https:\/\/[^/]+/, ''));
    calls.push(JSON.parse(init.body));
    return reply(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: ANSWER }] }] });
  };
  const r = await openai.invoke({ cfg: { provider: 'openai' }, prompt: 'P', env: { OPENAI_API_KEY: 'k', COACH_EFFORT: 'max' }, model: 'gpt-5', fetch: f, stream: false, web: true });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(urls, ['/v1/responses'], 'this is the Responses API, not chat completions');
  assert.deepEqual(calls[0].reasoning, { effort: 'high' });
  assert.ok(!('reasoning_effort' in calls[0]), 'the chat field, which this endpoint refuses');
});

test('a web request that refuses the level still gets an answer', async () => {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if ('reasoning' in body) return reply(400, { error: { message: "Invalid value: 'high' is not supported for 'reasoning.effort' with this model." } });
    return reply(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: ANSWER }] }] });
  };
  const r = await openai.invoke({ cfg: { provider: 'openai' }, prompt: 'P', env: { OPENAI_API_KEY: 'k', COACH_EFFORT: 'high' }, model: 'gpt-5', fetch: f, stream: false, web: true });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(calls.length, 2, 'asked, refused, asked again');
  assert.ok(!('reasoning' in calls[1]), 'the level was given up rather than failing the job');
});

test('a level refused by the replacement model is still given up on, not deduplicated away', async () => {
  // Gemini names the model in the URL, not in the body. So when a remembered fallback for the
  // first model makes the opening request look exactly like what the `effort` rung would build
  // for the replacement, a dedup that keys on the body alone refuses the retry and the job dies
  // on a model that would have answered. Reproduced with a remembered `effort` profile, which is
  // what the first job on a 2.5 endpoint leaves behind.
  const cfg = { provider: 'gemini' };
  const gone = 'gemini-2.5-pro-dedup';
  const replacement = 'gemini-3-flash-dedup';
  const { rememberCompatProfile } = await import('../coach/core/adapters/http.js');
  rememberCompatProfile('gemini', cfg, gone, ['effort']);

  const calls = [];
  const f = async (url, init) => {
    if (init?.method === 'GET') return reply(200, { models: [{ name: `models/${replacement}`, supportedGenerationMethods: ['generateContent'] }] });
    const body = JSON.parse(init.body);
    calls.push({ url: url.replace(/^https:\/\/[^/]+/, ''), hasLevel: !!(body.generationConfig || {}).thinkingConfig });
    if (/gemini-2\.5-pro-dedup/.test(url)) return reply(404, { error: { message: 'models/gemini-2.5-pro-dedup is not found for API version v1beta' } });
    if (body.generationConfig && body.generationConfig.thinkingConfig) {
      return reply(400, { error: { message: 'Field `generation_config.thinking_config` is not supported for model `gemini-3-flash-dedup`' } });
    }
    return reply(200, { candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] });
  };
  const r = await gemini.invoke({ cfg, prompt: 'P', env: { GEMINI_API_KEY: 'k', COACH_EFFORT: 'high' }, model: gone, fetch: f, stream: false });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls.map(c => c.hasLevel), [false, true, false],
    'no level (remembered), then the replacement asked, then asked again without it');
  assert.ok(calls[1].url.includes(replacement), 'the second request went to the replacement model');
});

test('a refusal is recognised in whichever spelling the endpoint uses', async () => {
  // The same field is written three ways: a request body in camelCase, an error path in snake_case
  // (Gemini reports `generation_config.thinking_config`, the way it reports
  // `generation_config.response_schema`), and OpenAI's flat reasoning_effort. A spelling the
  // matcher misses is a job that fails on a refusal the ladder was built to answer.
  const WORDS = [
    'Field `generation_config.thinking_config` is not supported for this model',
    'Unsupported parameter: reasoning_effort',
    "Unsupported value: 'high' does not support 'reasoning_effort' with this model",
    'thinkingLevel is not a supported thinking level for this model',
    'output_config.effort is not supported by this model',
    'this model takes thinkingBudget, not thinking_config'
  ];
  for (const words of WORDS) {
    const calls = [];
    const f = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if ('reasoning_effort' in body || 'output_config' in body || 'reasoning' in body
        || (body.generationConfig || {}).thinkingConfig) return reply(400, { error: { message: words } });
      return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
    };
    const r = await ask((await import('../coach/core/adapters/compatible.js')).default, at(), f);
    assert.equal(r.code, 0, `"${words}" was not recognised as a refusal: ${r.stderr}`);
    assert.equal(calls.length, 2, `"${words}": asked, refused, asked again`);
  }
});

test('a cut-off answer says which level was thinking, so the fix is obvious', async () => {
  const f = async () => reply(200, { choices: [{ message: { content: '{"coach_contract":1' }, finish_reason: 'length' }] });
  const r = await ask((await import('../coach/core/adapters/compatible.js')).default, at(), f);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /output limit/);
  assert.match(r.stderr, /high/, 'names the level, because raising the output limit is the fix');
});

/* ---------- how the setting reaches the adapter ---------- */

test('the job environment carries the level, since the core never reads process.env', async () => {
  const cfgStore = await import('../coach/config.js');
  // Whatever this process happens to carry is not the test's business: the unset case has to be
  // unset on purpose, and the original value has to be back when the test is done.
  const had = Object.prototype.hasOwnProperty.call(process.env, 'COACH_EFFORT');
  const was = process.env.COACH_EFFORT;
  if (had) delete process.env.COACH_EFFORT;
  try {
    assert.ok(!('COACH_EFFORT' in cfgStore.jobEnv('/tmp/job-1', null)), 'unset stays out of the environment');
    process.env.COACH_EFFORT = 'medium';
    assert.equal(cfgStore.jobEnv('/tmp/job-2', null).COACH_EFFORT, 'medium');
    process.env.COACH_EFFORT = '  High  ';
    assert.equal(cfgStore.jobEnv('/tmp/job-3', null).COACH_EFFORT, 'High', 'passed through as typed; the adapter judges it');
  } finally {
    if (had) process.env.COACH_EFFORT = was; else delete process.env.COACH_EFFORT;
  }
});
