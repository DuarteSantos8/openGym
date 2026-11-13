/* What a failed provider call says, and to whom.
 *
 * The chat used to answer every provider failure with one line, because the job runner sorted
 * every provider failure into one class. These are the two halves of the fix, asserted against
 * the real adapters where it matters: the class the status and the provider's words add up to,
 * and the short line a person reads, which must name the next step without ever repeating the
 * provider's own words (those go to the admin card and the server log, FR-12/42).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { classifyFailure, statusOf, redact, userMessageFor, USER_MESSAGE } = await import('../coach/core/failure.js');
const { attemptOnce } = await import('../coach/core/pipeline.js');
const openai = (await import('../coach/core/adapters/openai.js')).default;

const payload = { plan: { routines: [], week: {} } };
const env = { OPENAI_API_KEY: 'sk-oa-1' };

/** A fetch that answers from a script, like the one in adapters-http.test.js. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const a = typeof answers === 'function' ? answers(calls.length) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
  f.calls = calls;
  return f;
}
const ok = body => ({ status: 200, body });
const err = (status, message) => ({ status, body: { error: { message } } });
const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';

test('the status decides the class: refused key, quota, outage', () => {
  const cases = [
    [401, 'auth'], [403, 'auth'],
    [429, 'quota'], [402, 'quota'],
    [500, 'outage'], [502, 'outage'], [503, 'outage'], [504, 'outage'], [529, 'outage'],
    [400, 'provider'], [404, 'provider'], [413, 'provider']
  ];
  for (const [status, expect] of cases) {
    assert.equal(classifyFailure({ text: `${status} something the provider said` }), expect, `${status} → ${expect}`);
  }
  // The status is only read where a status can be: a provider's own words never start with one.
  assert.equal(statusOf('503 busy'), 503);
  assert.equal(statusOf('the model said 500'), null);
  assert.equal(statusOf(''), null);
  assert.equal(statusOf(undefined), null);
});

test('a 400 is read by its words: a refused key is auth, an empty balance is quota, a request shape is schema', () => {
  const cases = [
    // Google answers a bad key with a 400 (API_KEY_INVALID), not a 401.
    ['400 API key not valid. Please pass a valid API key.', 'auth'],
    ['400 Incorrect API key provided: sk-abc12345.', 'auth'],
    // Anthropic answers an empty balance with a 400 as well, and it is not a schema problem.
    ['400 Your credit balance is too low to access the Anthropic API.', 'quota'],
    // The strict-schema and plain-JSON retries in http.js have already happened by now, so this
    // is an endpoint that cannot serve the shape at all: another model, not another attempt.
    ["400 output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false", 'schema'],
    ['400 Invalid value for response_format: json_schema is not supported by this model', 'schema'],
    ['400 this model does not support structured output', 'schema'],
    // Everything else the provider refuses is its own words in `detail`, not a guess at a cause.
    ['400 temperature must be between 0 and 2', 'provider'],
    // The case that made the old word match wrong: a budget error that says "token" is not a
    // rejected key.
    ['400 The input token count exceeds the maximum number of tokens allowed.', 'provider']
  ];
  for (const [text, expect] of cases) assert.equal(classifyFailure({ text }), expect, `${text} → ${expect}`);
});

test('a 403 about the plan is quota, not a rejected credential', () => {
  assert.equal(classifyFailure({ text: '403 You exceeded your current quota, please check your plan and billing details.' }), 'quota');
  assert.equal(classifyFailure({ text: '403 Forbidden: the key does not have access to this model.' }), 'auth');
});

test('nothing answered is unreachable, a budget that ran out is a timeout, and no key is missing', () => {
  const network = [
    'could not reach ollama.lan:11434: fetch failed',
    'could not reach api.openai.com: connect ECONNREFUSED 10.0.0.4:443',
    'Error: getaddrinfo ENOTFOUND api.example.invalid',
    'socket hang up',
    'TLS handshake failed: certificate has expired'
  ];
  for (const text of network) assert.equal(classifyFailure({ text }), 'unreachable', text);

  // The pipeline's own timeout, and a runtime CLI that says it in words.
  assert.equal(classifyFailure({ text: '', timedOut: true }), 'timeout');
  assert.equal(classifyFailure({ text: 'the provider timed out after 300s' }), 'timeout');

  // No credential, no endpoint: nothing was called at all, so no provider is being blamed.
  assert.equal(classifyFailure({ text: 'no API key configured for openai', spawnError: true }), 'missing');
  assert.equal(classifyFailure({}), 'provider');
});

test('a CLI runtime with no status keeps its words: auth, quota, and otherwise provider', () => {
  assert.equal(classifyFailure({ text: 'Error: ANTHROPIC_API_KEY is not set' }), 'auth');
  assert.equal(classifyFailure({ text: 'you are out of quota, upgrade your plan' }), 'quota');
  assert.equal(classifyFailure({ text: 'the agent runtime crashed: ENOENT' }), 'provider');
});

test('the pipeline carries the class out of a real adapter, with the provider’s words as detail', async () => {
  const cases = [
    [err(429, 'Rate limit reached for gpt-4 in organization org-abc on requests per min.'), 'quota'],
    [err(401, 'Incorrect API key provided: sk-proj-abcdefgh12345678.'), 'auth'],
    [err(400, "output_config.format.schema: 'additionalProperties' must be explicitly set to false"), 'schema'],
    [err(503, 'The engine is currently overloaded, please try again later.'), 'outage']
  ];
  for (const [answer, expect] of cases) {
    const f = fakeFetch([answer, answer, answer]);   // a transient status is retried before it fails
    const r = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: f, retryDelayMs: 0 } }, null);
    assert.equal(r.ok, false);
    assert.equal(r.errorClass, expect, `${answer.status} → ${expect}: ${r.detail}`);
    assert.ok(r.detail.startsWith(String(answer.status)), `the detail keeps the status: ${r.detail}`);
    // The line the person reads is the class's, not the provider's.
    const line = userMessageFor(r.errorClass, r.detail);
    assert.ok(line, `${expect} has a line`);
    assert.ok(!line.includes('additionalProperties') && !line.includes('sk-proj'), 'the detail stays out of the line');
  }
});

test('a 429 that is out of quota reads differently from one that is merely going too fast', async () => {
  const exhausted = fakeFetch([err(429, 'You exceeded your current quota, please check your plan and billing details.')]);
  const a = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: exhausted, retryDelayMs: 0 } }, null);
  assert.equal(a.errorClass, 'quota');
  assert.equal(userMessageFor(a.errorClass, a.detail), USER_MESSAGE.quota);

  const fast = fakeFetch([err(429, 'Rate limit reached for gpt-4 on requests per min.')]);
  const b = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: fast, retryDelayMs: 0 } }, null);
  assert.equal(b.errorClass, 'quota');
  assert.notEqual(userMessageFor(b.errorClass, b.detail), USER_MESSAGE.quota);
  assert.match(userMessageFor(b.errorClass, b.detail), /rate limited/i);
});

test('a working call is untouched by any of this', async () => {
  const f = fakeFetch([ok({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })]);
  const r = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env, fetch: f } }, null);
  assert.equal(r.ok, true);
  assert.equal(r.nochange, true);
  assert.equal(r.errorClass, undefined);
});

test('every provider class has one short line, and no two classes say the same thing', () => {
  const classes = Object.keys(USER_MESSAGE);
  assert.deepEqual(classes.sort(), ['auth', 'cutoff', 'missing', 'outage', 'provider', 'quota', 'schema', 'timeout', 'unreachable']);
  const seen = new Map();
  for (const cls of classes) {
    const line = USER_MESSAGE[cls];
    assert.ok(line.length > 20 && line.length <= 130, `${cls} is one line, not a paragraph (${line.length})`);
    assert.ok(!/[\u2014\u2013]/.test(line), `${cls} has no em or en dash`);
    assert.ok(!/\bsk-|AIza|Bearer /.test(line), `${cls} carries no credential`);
    assert.equal(seen.has(line), false, `${cls} repeats ${seen.get(line)}`);
    seen.set(line, cls);
  }
  // Not every failure class is a provider one: a revoked consent, a missing profile and a model
  // that answered outside the contract have their own words in the app already.
  for (const cls of ['unusable', 'consent', 'nostate', 'restart', 'toolong', undefined]) {
    assert.equal(userMessageFor(cls, 'anything'), null, `${cls} has no server-side line`);
  }
});

test('detail is redacted before it can reach coach.json or the container log', () => {
  assert.equal(redact('Incorrect API key provided: sk-proj-abcdefgh12345678.'), 'Incorrect API key provided: sk-….');
  assert.equal(redact('bad key AIzaSyD-1234567890abcdefghijklmnop'), 'bad key AIza…');
  assert.equal(redact('Authorization: Bearer 0123456789abcdef'), 'Authorization: …');
  assert.equal(redact('x-api-key: 9f8e7d6c5b4a3f2e1d'), 'x-api-key: …');
  assert.equal(redact('api_key="a-very-long-value-here"'), 'api_key: …');
  // Ordinary words survive: a message about a model, a plan or a schema is what the owner needs.
  assert.equal(redact('400 the model "gpt-4o-mini-tts" is not available to this key'), '400 the model "gpt-4o-mini-tts" is not available to this key');
  // One line, and never longer than the cap.
  assert.equal(redact('line one\nline two\t\tline three'), 'line one line two line three');
  assert.equal(redact('x'.repeat(400)).length, 300);
  assert.equal(redact(undefined), '');
});

test('the detail a job would log never contains the key that was refused', async () => {
  const key = 'sk-proj-supersecret0123456789';
  const f = fakeFetch([err(401, `Incorrect API key provided: ${key}. You can find your API key at ...`)]);
  const r = await attemptOnce({ adapter: openai, cfg: {}, kind: 'review', payload, invokeOpts: { env: { OPENAI_API_KEY: key }, fetch: f } }, null);
  assert.equal(r.errorClass, 'auth');
  assert.equal(r.detail.includes(key), false, 'the refused key is not in the detail');
  assert.ok(r.detail.includes('sk-…'), r.detail);
});
