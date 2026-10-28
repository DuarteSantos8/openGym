/* The OpenAI-compatible endpoint against gateways that say no without saying why (#804).
 *
 * LiteLLM, one-api/new-api, vLLM, Azure and the resellers in front of them each refuse a
 * different part of a Chat Completions request, and several hide the reason behind one generic
 * 400 ("The request could not be processed. Please check the request parameters."). The stand-in
 * below is such a gateway: it takes a list of rules, checks the body the way those servers do,
 * and answers the first broken rule with a 400 in either its own words or the generic ones.
 *
 * What is asserted: the adapter finds a request shape the gateway accepts within a bounded
 * number of tries, remembers it per endpoint and model, and when nothing works hands back the
 * gateway's own words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const compatible = (await import('../coach/core/adapters/compatible.js')).default;
const openai = (await import('../coach/core/adapters/openai.js')).default;
const { compatProfile, rememberCompatProfile } = await import('../coach/core/adapters/http.js');
const { REVIEW_SCHEMA, ASK_SCHEMA } = await import('../coach/core/schemas.js');

const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';
const GENERIC = 'The request could not be processed. Please check the request parameters.';

// Walks a JSON schema the way a strict validator does: every object closed, every array typed,
// one type per node.
function strictProblems(node, at = '$') {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  if (Array.isArray(node.type)) out.push(`${at}: type unions are not supported`);
  if ((node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))) && node.additionalProperties !== false) out.push(`${at}: additionalProperties must be false`);
  if ((node.type === 'array' || (Array.isArray(node.type) && node.type.includes('array'))) && !node.items) out.push(`${at}: array schema missing items`);
  for (const [k, v] of Object.entries(node.properties || {})) out.push(...strictProblems(v, `${at}.${k}`));
  if (node.items) out.push(...strictProblems(node.items, `${at}[]`));
  return out;
}
const schemaOf = b => b.response_format && b.response_format.type === 'json_schema' ? b.response_format.json_schema.schema : null;

// Each rule: [name, body => true when the gateway refuses it, its own words].
const RULES = {
  closedSchema: [b => !!schemaOf(b) && strictProblems(schemaOf(b)).some(p => /additionalProperties/.test(p)), "For 'object' type, 'additionalProperties' must be explicitly set to false"],
  portableSchema: [b => !!schemaOf(b) && strictProblems(schemaOf(b)).length > 0, 'Invalid schema for response_format: array schema missing items'],
  noSchema: [b => !!schemaOf(b), "response_format type 'json_schema' is not supported"],
  noJsonMode: [b => 'response_format' in b, 'response_format is not supported by this model'],
  completionTokens: [b => 'max_tokens' in b, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."],
  legacyTokens: [b => 'max_completion_tokens' in b, 'Unrecognized request argument supplied: max_completion_tokens'],
  noTemperature: [b => 'temperature' in b, "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."]
};

/** A gateway that enforces `rules` and answers a broken one generically unless `say` is set. */
function gateway(rules, { say = false, status = 400 } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (init.method === 'GET') return reply(200, { data: [{ id: 'gpt-6.1-sol' }] });
    for (const name of rules) {
      const [broken, words] = RULES[name];
      if (broken(body)) return reply(status, { error: { message: say ? words : GENERIC, type: 'invalid_request_error', code: null } });
    }
    return reply(200, { choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] });
  };
  f.calls = calls;
  return f;
}
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
let n = 0;
// A fresh endpoint per test, so what one test taught the adapter never helps the next.
const at = () => ({ provider: 'compatible', providerOptions: { compatible: { baseUrl: `https://gw${++n}.test/v1` } } });
const ask = (cfg, f, extra = {}) => compatible.invoke({ cfg, prompt: 'P', system: 'S', schema: REVIEW_SCHEMA, env: {}, model: 'gpt-6.1-sol', fetch: f, ...extra });

test('the request the phone sends a compatible endpoint, as a strict gateway sees it (#804)', async () => {
  const f = gateway([]);
  await ask(at(), f);
  const b = f.calls[0].body;
  assert.equal(f.calls[0].url.replace(/^https:\/\/[^/]+/, ''), '/v1/chat/completions', 'the /v1 in the base is not doubled');
  assert.equal(b.max_tokens, 16000);
  assert.equal(b.temperature, 0);
  assert.equal(b.response_format.type, 'json_schema');
  // the flat schema is what a strict gateway trips on: open objects, a union with an untyped array
  assert.ok(strictProblems(schemaOf(b)).length > 0);
  for (const k of ['stream', 'n', 'tools', 'seed']) assert.ok(!(k in b), k);
});

test('a generic 400 for an open schema is answered with the strict copy and works (#804)', async () => {
  const f = gateway(['closedSchema']);
  const r = await ask(at(), f);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(f.calls.length, 2);
  assert.equal(schemaOf(f.calls[1].body).additionalProperties, false);
});

test('a generic 400 for a schema the gateway cannot take at all lands on plain JSON mode (#804)', async () => {
  const f = gateway(['portableSchema']);
  const r = await ask(at(), f);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(f.calls.at(-1).body.response_format, { type: 'json_object' });
  assert.equal(f.calls.at(-1).body.temperature, 0, 'nothing else was given up on the way');
  assert.equal(f.calls.at(-1).body.max_tokens, 16000);
});

test('a reasoning model behind a gateway that wants max_completion_tokens, said generically or in words (#804)', async () => {
  for (const say of [false, true]) {
    const f = gateway(['completionTokens'], { say });
    const r = await ask(at(), f);
    assert.equal(r.code, 0, r.stderr);
    const last = f.calls.at(-1).body;
    assert.equal(last.max_completion_tokens, 16000);
    assert.ok(!('max_tokens' in last));
    // told in words, the adapter goes straight there and keeps the schema
    if (say) { assert.equal(f.calls.length, 2); assert.equal(last.response_format.type, 'json_schema'); }
  }
});

test('a model that refuses temperature 0 gets the request without it (#804)', async () => {
  for (const say of [false, true]) {
    const f = gateway(['noTemperature'], { say });
    const r = await ask(at(), f);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!('temperature' in f.calls.at(-1).body));
    if (say) assert.equal(f.calls.length, 2);
  }
});

test('a gateway that takes no response_format at all gets JSON asked for in the prompt only (#804)', async () => {
  const f = gateway(['noJsonMode']);
  const r = await ask(at(), f);
  assert.equal(r.code, 0, r.stderr);
  const last = f.calls.at(-1).body;
  assert.ok(!('response_format' in last));
  assert.match(last.messages[0].content, /JSON/);
});

test('several refusals at once are worked through, and the try count stays bounded (#804)', async () => {
  const f = gateway(['portableSchema', 'completionTokens', 'noTemperature']);
  const r = await ask(at(), f);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(f.calls.length <= 6, `${f.calls.length} calls`);
});

test('the shape that worked is remembered per endpoint and model, so the next job asks once (#804)', async () => {
  const cfg = at();
  const f = gateway(['portableSchema', 'noTemperature']);
  assert.equal((await ask(cfg, f)).code, 0);
  const learnt = compatProfile('compatible', cfg, 'gpt-6.1-sol');
  assert.ok(Array.isArray(learnt) && learnt.length > 0, 'a profile was kept');
  const g = gateway(['portableSchema', 'noTemperature']);
  assert.equal((await ask(cfg, g)).code, 0);
  assert.equal(g.calls.length, 1, 'straight to the shape that worked');
  // another model on the same endpoint starts from the full request again
  const h = gateway([]);
  await compatible.invoke({ cfg, prompt: 'P', schema: ASK_SCHEMA, env: {}, model: 'other-model', fetch: h });
  assert.equal(h.calls[0].body.temperature, 0);
  assert.equal(h.calls[0].body.response_format.type, 'json_schema');
});

test('a profile handed in from elsewhere (the phone’s device file) is used from the first request (#804)', async () => {
  const cfg = at();
  rememberCompatProfile('compatible', cfg, 'gpt-6.1-sol', ['json_object', 'temperature']);
  const f = gateway(['portableSchema', 'noTemperature']);
  assert.equal((await ask(cfg, f)).code, 0);
  assert.equal(f.calls.length, 1);
  // junk in the file is ignored, not sent
  rememberCompatProfile('compatible', cfg, 'gpt-6.1-sol', ['nope', 42]);
  assert.deepEqual(compatProfile('compatible', cfg, 'gpt-6.1-sol'), null);
});

test('when nothing works, the gateway’s own words come back, after a bounded number of tries (#804)', async () => {
  const f = gateway(['noTemperature', 'noJsonMode', 'legacyTokens', 'completionTokens']);
  const r = await ask(at(), f);
  assert.equal(r.code, 1);
  assert.ok(r.stderr.startsWith('400 '), r.stderr);
  assert.ok(r.stderr.includes(GENERIC), r.stderr);
  assert.ok(f.calls.length <= 6, `${f.calls.length} calls`);
});

test('a 400 that names a parameter the request does not carry is not retried blindly', async () => {
  // OpenAI itself sends no temperature; a complaint about one is not something a retry fixes.
  const f = gateway(['noTemperature'], { say: true });
  const r = await openai.invoke({ cfg: {}, prompt: 'P', env: { OPENAI_API_KEY: 'k' }, fetch: async (u, i) => {
    f.calls.push(1); return reply(400, { error: { message: 'temperature must be between 0 and 2' } });
  } });
  assert.equal(r.code, 1);
  assert.equal(f.calls.length, 1);
});

test('OpenAI itself never walks the generic ladder: its errors name what is wrong', async () => {
  let calls = 0;
  const r = await openai.invoke({ cfg: {}, prompt: 'P', schema: REVIEW_SCHEMA, env: { OPENAI_API_KEY: 'k' }, fetch: async () => { calls++; return reply(400, { error: { message: GENERIC } }); } });
  assert.equal(r.code, 1);
  assert.equal(calls, 1);
});
