/* An API key pasted in the admin card, end to end: the routes file the key, the job runner
 * decrypts it, the HTTP adapter puts it on the wire with the real undici fetch, the pipeline
 * parses and validates the answer, and the proposal lands in the user's record. The only
 * fake is the provider — a local HTTP server that speaks each provider's wire shape and
 * records what it was sent — reached through the base-URL override the config supports.
 *
 * This is the test that says "if somebody puts in an API key it actually works", short of
 * spending money against the real endpoint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

/* ---------- a provider on localhost ---------- */
const seen = [];
const REVIEW_NOCHANGE = { coach_contract: 1, nochange: true, reading: 'Plan not trained long enough to judge.' };
const REVIEW_CHANGE = {
  coach_contract: 1,
  summary: 'Top sets at RPE 10 on the dumbbell press; one set less.',
  evidence: { from: '2026-07-20', to: '2026-07-20', sessions: 1 },
  changes: [{ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, before: 3, after: 2, why: 'stalls ≥ 2 and every top set at RPE 10' }],
  notes: []
};
let answerWith = REVIEW_NOCHANGE;
let failFirst = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const rec = { url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    seen.push(rec);
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    // Model listings, one shape per provider.
    if (req.method === 'GET' && req.url.startsWith('/v1/models') && !req.url.startsWith('/v1beta')) return send(200, { data: [{ id: 'model-a' }, { id: 'model-b' }] });
    if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) return send(200, { models: [{ name: 'models/gem-a', supportedGenerationMethods: ['generateContent'] }] });
    if (failFirst > 0) { failFirst--; return send(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }); }
    const text = JSON.stringify(answerWith);
    if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    if (req.url === '/v1/chat/completions') return send(200, { choices: [{ message: { content: text }, finish_reason: 'stop' }] });
    if (/^\/v1beta\/models\/.+:generateContent$/.test(req.url)) return send(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
    send(404, { error: { message: 'unknown route ' + req.url } });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* ---------- the routes, driven like server.js drives them ---------- */
const admin = { id: 'admin', name: 'Admin' };
const fakeReq = (body, user = admin) => ({ headers: {}, _body: body, _user: user });
const fakeRes = () => { const r = { status: 0, body: null }; return r; };
const routes = coachRoutes({
  json: (res, code, obj) => { res.status = code; res.body = obj; },
  readBody: async req => req._body || {},
  readSession: req => req._user,
  requireAdmin: (req, res) => { if (req._user?.id === 'admin') return req._user; res.status = 403; return null; }
});
const call = async (route, body) => { const res = fakeRes(); await routes[route](fakeReq(body), res); return res; };

async function settle(uid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

/** Paste a key for `provider`, point it at the local server, choose a model, run a review. */
async function runReview(provider, key, uid) {
  seen.length = 0;
  cfg.reset();
  cfg.save({ enabled: true, provider, authMode: 'instance', auth: {}, models: {}, boundUid: {}, log: [], caps: { perProfileDaily: 50, instanceDaily: 0 },
    providerOptions: { [provider]: { baseUrl: BASE } } });
  let r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: key });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('POST /api/admin/coach/models', {});
  assert.equal(r.body.ok, true, 'the pasted key lists models: ' + JSON.stringify(r.body));
  assert.ok(r.body.models.length >= 1);
  r = await call('POST /api/admin/coach/config', { model: r.body.models[0] });
  assert.equal(r.status, 200);
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  return jobs.readUser(uid);
}

test('Anthropic: the pasted key travels as x-api-key, the rules are the cached system block, and the review lands', async () => {
  answerWith = REVIEW_CHANGE;
  const rec = await runReview('anthropic', 'sk-ant-test-123', 'u-anthropic');
  const job = seen.find(s => s.url === '/v1/messages');
  assert.ok(job, 'a /v1/messages request was made');
  assert.equal(job.headers['x-api-key'], 'sk-ant-test-123');
  assert.equal(job.headers['anthropic-version'], '2023-06-01');
  assert.equal(job.body.model, 'model-a');
  assert.ok(Array.isArray(job.body.system) && job.body.system[0].cache_control?.type === 'ephemeral', 'rules block is marked cacheable');
  assert.match(job.body.system[0].text, /Output is JSON and nothing else/);
  assert.match(job.body.messages[0].content, /"coach_contract":1/);
  assert.ok(!JSON.stringify(job.body).includes('sk-ant-test'), 'the key is never in the body');
  assert.ok(!seen.some(s => s.url.includes('sk-ant')), 'the key is never in a URL');
  assert.equal(rec.history.at(-1).outcome, 'ready', JSON.stringify(rec.history.at(-1)));
  assert.equal(rec.pending.changes.length, 1);
  assert.equal(rec.pending.changes[0].type, 'sets');
  // Every profile may use an API key: a second profile is not refused.
  writeState(DIR, 'u-anthropic-2', sampleState());
  assert.doesNotThrow(() => jobs.enqueue('u-anthropic-2', { kind: 'review' }));
  await settle('u-anthropic-2');
  assert.equal(jobs.readUser('u-anthropic-2').history.at(-1).outcome, 'ready');
});

test('OpenAI: bearer auth, json_schema response format, max_completion_tokens; "nothing to change" is its own outcome', async () => {
  answerWith = REVIEW_NOCHANGE;
  const rec = await runReview('openai', 'sk-oa-test-456', 'u-openai');
  const job = seen.find(s => s.url === '/v1/chat/completions');
  assert.ok(job);
  assert.equal(job.headers.authorization, 'Bearer sk-oa-test-456');
  assert.equal(job.body.response_format.type, 'json_schema');
  assert.ok('max_completion_tokens' in job.body);
  assert.equal(job.body.messages[0].role, 'system');
  assert.equal(rec.history.at(-1).outcome, 'nochange');
  assert.match(rec.history.at(-1).reading, /not trained/);
});

test('Gemini: x-goog-api-key header, generateContent, JSON mime type', async () => {
  answerWith = REVIEW_NOCHANGE;
  await runReview('gemini', 'AIza-test-789', 'u-gemini');
  const job = seen.find(s => /:generateContent$/.test(s.url));
  assert.ok(job);
  assert.equal(job.headers['x-goog-api-key'], 'AIza-test-789');
  assert.ok(!job.url.includes('key='), 'never ?key=');
  assert.equal(job.body.generationConfig.responseMimeType, 'application/json');
  assert.match(job.body.systemInstruction.parts[0].text, /openGym Coach/);
});

test('an overloaded provider is retried and the job still succeeds', async () => {
  answerWith = REVIEW_NOCHANGE;
  failFirst = 1;
  const rec = await runReview('anthropic', 'sk-ant-retry', 'u-retry');
  assert.equal(seen.filter(s => s.url === '/v1/messages').length, 2, 'one 529, one 200');
  assert.equal(rec.history.at(-1).outcome, 'nochange');
});

test('a wrong key is reported as an auth failure, with the provider\'s reason kept for the admin card', async () => {
  cfg.reset();
  cfg.save({ enabled: true, provider: 'anthropic', authMode: 'instance', auth: {}, models: {}, boundUid: {}, log: [],
    providerOptions: { anthropic: { baseUrl: BASE + '/reject' } } });
  // /reject/... is not served, so every call is a 404 — stand in for a provider saying no.
  await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'sk-bad' });
  const r = await call('POST /api/admin/coach/models', {});
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /^404/);
  const status = await call('GET /api/admin/coach', {});
  assert.equal(status.body.runtime.ok, false);
  assert.equal(status.body.auth.state, 'connected', 'the key is filed even though the provider rejects it — the card says why');
});
