/* The admin routes, driven with fake server helpers — the layer between the card and the
 * config store, which learned per-provider keys, a base URL, a model list and the "this
 * provider spawns nothing" report. The user routes are exercised through jobs.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData } from './helpers.mjs';

tempData();
const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');
const { socialRoutes } = await import('../social/routes.js');
const { socialSummary } = await import('../social/summary.js');

function socialHarness() {
  const people = [
    { id: 'alice', name: 'Alice', pw: 'private' }, { id: 'bob', name: 'Bob', avatar: 'private' },
    { id: 'carol', name: 'Carol' }, { id: 'disabled', name: 'Disabled', disabled: true }
  ];
  let data = { connections: [], blocks: [] };
  const routes = socialRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body,
    readSession: req => people.find(p => p.id === req.uid && !p.disabled),
    users: () => people,
    readState: () => ({ bodyweight: [{ d: '2026-10-10', w: 75 }], notes: 'private', routines: [{ name: 'private' }],
      workouts: [{ d: '2026-10-09', note: 'private', entries: [{ id: 'strength', sets: [{ done: true, w: 50, r: 8 }] }] }] }),
    load: () => JSON.parse(JSON.stringify(data)),
    save: value => { data = JSON.parse(JSON.stringify(value)); },
    userNow: () => ({ date: '2026-10-10' })
  });
  return {
    people, routes,
    seed: value => { data = value; },
    call: async (key, uid, body = {}) => { const res = {}; await routes[key]({ uid, body }, res); return res; }
  };
}

test('Social discloses only identity before acceptance and the four summary fields afterwards', async () => {
  const h = socialHarness();
  assert.equal((await h.call('GET /api/social')).status, 401);
  assert.equal((await h.call('GET /api/social', 'disabled')).status, 401);
  const before = await h.call('GET /api/social', 'alice');
  assert.deepEqual(before.body.suggestions, [{ id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]);
  assert.equal((await h.call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 200);
  assert.deepEqual((await h.call('GET /api/social', 'bob')).body.incoming, [{ id: 'alice', name: 'Alice' }]);
  assert.deepEqual((await h.call('GET /api/social', 'alice')).body.friends, []);
  assert.equal((await h.call('POST /api/social/accept', 'carol', { userId: 'alice' })).status, 404);
  assert.equal((await h.call('POST /api/social/accept', 'alice', { userId: 'bob' })).status, 404);
  assert.equal((await h.call('POST /api/social/accept', 'bob', { userId: 'alice' })).status, 200);
  assert.deepEqual((await h.call('GET /api/social', 'alice')).body.friends, [{
    id: 'bob', name: 'Bob', weekStreak: 1, thisWeek: 1, lastWorkout: '2026-10-09', recordCount: 1
  }]);
  assert.deepEqual(Object.keys(h.routes).sort(), [
    'GET /api/social', 'POST /api/social/accept', 'POST /api/social/block',
    'POST /api/social/remove', 'POST /api/social/request', 'POST /api/social/unblock'
  ]);
});

test('Social removal revokes progress and requests can be declined or cancelled', async () => {
  const h = socialHarness();
  await h.call('POST /api/social/request', 'alice', { userId: 'bob' });
  await h.call('POST /api/social/remove', 'bob', { userId: 'alice' });
  assert.deepEqual((await h.call('GET /api/social', 'alice')).body.outgoing, []);
  await h.call('POST /api/social/request', 'alice', { userId: 'bob' });
  await h.call('POST /api/social/remove', 'alice', { userId: 'bob' });
  assert.deepEqual((await h.call('GET /api/social', 'bob')).body.incoming, []);
  await h.call('POST /api/social/request', 'alice', { userId: 'bob' });
  await h.call('POST /api/social/accept', 'bob', { userId: 'alice' });
  await h.call('POST /api/social/remove', 'alice', { userId: 'bob' });
  assert.deepEqual((await h.call('GET /api/social', 'alice')).body.friends, []);
  assert.deepEqual((await h.call('GET /api/social', 'bob')).body.friends, []);
});

test('Social blocks revoke both directions and unblocking never restores a friendship', async () => {
  const h = socialHarness();
  await h.call('POST /api/social/request', 'alice', { userId: 'bob' });
  await h.call('POST /api/social/accept', 'bob', { userId: 'alice' });
  await h.call('POST /api/social/block', 'alice', { userId: 'bob' });
  await h.call('POST /api/social/block', 'bob', { userId: 'alice' });
  for (const [uid, target] of [['alice', 'bob'], ['bob', 'alice']]) {
    const r = await h.call('GET /api/social', uid);
    assert.deepEqual(r.body.friends, []);
    assert.ok(!r.body.suggestions.some(p => p.id === target));
    assert.equal((await h.call('POST /api/social/request', uid, { userId: target })).status, 403);
  }
  await h.call('POST /api/social/unblock', 'alice', { userId: 'bob' });
  assert.equal((await h.call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 403);
  await h.call('POST /api/social/unblock', 'bob', { userId: 'alice' });
  assert.deepEqual((await h.call('GET /api/social', 'alice')).body.friends, []);
  assert.equal((await h.call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 200);
});

test('Social rejects self, disabled, missing and duplicate targets and enforces both account limits', async () => {
  const h = socialHarness();
  for (const [target, status] of [['alice', 400], ['disabled', 404], ['missing', 404]]) {
    assert.equal((await h.call('POST /api/social/request', 'alice', { userId: target })).status, status);
  }
  await h.call('POST /api/social/request', 'alice', { userId: 'bob' });
  assert.equal((await h.call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 409);
  assert.equal((await h.call('POST /api/social/request', 'bob', { userId: 'alice' })).status, 409);
  h.people.find(p => p.id === 'bob').disabled = true;
  assert.equal((await h.call('POST /api/social/accept', 'alice', { userId: 'bob' })).status, 404);
  for (const capped of ['alice', 'carol']) {
    h.seed({ connections: Array.from({ length: 100 }, (_, i) => ({ from: capped, to: `person-${i}`, status: 'pending' })), blocks: [] });
    assert.equal((await h.call('POST /api/social/request', 'alice', { userId: 'carol' })).status, 409);
  }
});

test('Social summaries ignore unfinished/warm-up work, count repeated exercises once and share no raw values', () => {
  const state = { notes: 'private', bodyweight: [{ d: '2026-10-09', w: 80 }], workouts: [
    { d: '2026-10-01', entries: [{ id: 'strength', sets: [{ done: true, w: 40, r: 8 }] }] },
    { d: '2026-10-09', entries: [
      { id: 'strength', sets: [{ done: true, w: 45, r: 8 }] },
      { id: 'strength', sets: [{ done: true, w: 50, r: 8 }] },
      { id: 'warmup', topW: 100, sets: [{ done: true, warmup: true, w: 100, r: 8 }] },
      { id: 'unfinished', sets: [{ done: false, w: 100, r: 8 }] },
      { id: 'limbs', sets: [{ sides: { L: { done: true, w: 10, r: 8 }, R: { done: false, w: 20, r: 8 } } }] },
      { id: 'cardio', target: { mode: 'cardio' }, sets: [{ done: true, min: 20, speed: 8 }] },
      { id: 'hold', target: { mode: 'time' }, sets: [{ done: true, sec: 30 }] },
      null
    ] },
    { d: '2026-11-01', entries: [{ id: 'future', topW: 50 }] },
    { d: '2026-02-31', entries: [] }, null
  ] };
  assert.deepEqual(socialSummary(state, '2026-10-10'), { weekStreak: 2, thisWeek: 1, lastWorkout: '2026-10-09', recordCount: 4 });
  assert.deepEqual(socialSummary(null, '2026-10-10'), { weekStreak: 0, thisWeek: 0, lastWorkout: null, recordCount: 0 });
});

// Every test starts from an empty coach.json: reset() only forgets the cache, and save() merges
// over what is on disk, so a key filed by the previous test would otherwise still be there.
const fresh = (patch = {}) => { cfg.reset(); cfg.save({ enabled: true, provider: 'fixture', auth: {}, models: {}, providerOptions: {}, boundUid: {}, ...patch }); };

// The four helpers server.js hands in, as fakes: an admin is always signed in here.
function harness() {
  const out = {};
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'admin-1', admin: true }),
    requireAdmin: () => true
  });
  const call = async (key, body) => { const res = {}; await routes[key]({ body }, res); return res; };
  out.call = call; out.routes = routes;
  return out;
}

/** A local endpoint speaking the OpenAI list shape, so no test ever reaches the internet. */
async function mockEndpoint(models = ['llama3', 'gemma']) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: models.map(id => ({ id })) }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('the admin card is told which providers hold a key, and switching never drops one', async () => {
  const mock = await mockEndpoint();
  try {
    fresh();
    const { call } = harness();

    // The active provider is the local endpoint; keys for two cloud providers are filed while
    // they are NOT active — the chips can be prepared ahead of switching.
    let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: mock.base });
    assert.equal(r.status, 200);
    r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'k-compat', account: 'lan' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await call('POST /api/admin/coach/connect', { provider: 'anthropic', type: 'apikey', token: 'sk-ant-x', account: 'me' });
    assert.equal(r.status, 200);
    r = await call('POST /api/admin/coach/connect', { provider: 'openai', type: 'apikey', token: 'sk-oa-x' });
    assert.equal(r.status, 200);

    r = await call('GET /api/admin/coach');
    assert.equal(r.status, 200);
    const byId = Object.fromEntries(r.body.providers.map(p => [p.id, p]));
    assert.equal(byId.compatible.connected, true);
    assert.equal(byId.anthropic.connected, true);
    assert.equal(byId.openai.connected, true);
    assert.equal(byId.gemini.connected, false);
    assert.equal(byId.compatible.keyOptional, true);
    assert.equal(byId.compatible.baseUrl, true);
    assert.equal(byId.claude.setupToken, true);
    assert.equal(byId.openai.http, true);
    assert.equal(byId.openai.defaultModel, 'gpt-5.6');
    assert.equal(r.body.auth.state, 'connected');
    assert.equal(r.body.auth.type, 'apikey');
    assert.equal(r.body.auth.account, 'lan');
    assert.ok(r.body.auth.connectedAt);
    assert.equal(r.body.model, null, 'a compatible endpoint has no default model');
    assert.deepEqual(r.body.unprivileged, { ok: true, dropped: false, why: 'this provider runs no child process' });
    assert.equal(r.body.runtime.ok, true, r.body.runtime.error);
    assert.match(r.body.runtime.version, /2 models/);
    assert.deepEqual(r.body.knownModels, ['gemma', 'llama3']);
    for (const secret of ['sk-ant-x', 'sk-oa-x', 'k-compat']) assert.ok(!JSON.stringify(r.body).includes(secret), 'no key ever comes back');

    // Each provider keeps its own model; switching away and back loses nothing.
    await call('POST /api/admin/coach/config', { model: 'llama3' });
    await call('POST /api/admin/coach/config', { provider: 'openai', model: 'gpt-x' });
    await call('POST /api/admin/coach/config', { provider: 'anthropic' });
    assert.equal(cfg.modelFor(), 'claude-opus-5', 'anthropic falls back to its default');
    assert.equal(cfg.modelFor(cfg.load(), 'openai'), 'gpt-x');
    assert.equal(cfg.credentialFor('alice').auth.token, 'sk-ant-x');
    await call('POST /api/admin/coach/config', { provider: 'compatible' });
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.auth.state, 'connected');
    assert.equal(r.body.model, 'llama3');
    assert.equal(r.body.models.openai, 'gpt-x');

    // Disconnecting one provider leaves the others alone.
    r = await call('POST /api/admin/coach/disconnect', { provider: 'openai' });
    assert.equal(r.status, 200);
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.auth.state, 'connected', 'the active provider is still connected');
    assert.equal(r.body.providers.find(p => p.id === 'openai').connected, false);
    assert.equal(r.body.providers.find(p => p.id === 'anthropic').connected, true);
  } finally { mock.close(); }
});

test('a key filed for a provider that does not take one, or an unknown provider, is refused', async () => {
  fresh();
  const { call } = harness();
  let r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'x' });
  assert.equal(r.status, 400);
  r = await call('POST /api/admin/coach/connect', { provider: 'nope', type: 'apikey', token: 'x' });
  assert.equal(r.status, 400);
  r = await call('POST /api/admin/coach/connect', { provider: 'openai', type: 'cli-token', token: 'x' });
  assert.equal(r.status, 400, 'openai has no oauth variable');
  r = await call('POST /api/admin/coach/config', { provider: 'openai', baseUrl: 'http://x' });
  assert.equal(r.status, 400, 'openai has a fixed endpoint');
});

test('the compatible endpoint: base URL is validated, a keyless endpoint counts as connected, and models come from it', async () => {
  const mock = await mockEndpoint();
  const base = mock.base;
  try {
    fresh();
    const { call } = harness();
    let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: 'http://user:pw@x' });
    assert.equal(r.status, 400);
    // Empty passes validateBaseUrl on purpose (it means "the default" for anthropic/openai/gemini),
    // but compatible has no default, so empty is nowhere to call. This used to save baseUrl: null
    // and baseUrlFor() then handed the adapter ''. The phone refuses it too.
    r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: '' });
    assert.equal(r.status, 400, 'an empty endpoint for a provider with no default');
    assert.match(r.body.error, /no default endpoint/);
    r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: '   ' });
    assert.equal(r.status, 400, 'whitespace is empty');
    r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: base + '/' });
    assert.equal(r.status, 200);

    r = await call('GET /api/admin/coach');
    assert.equal(r.body.baseUrl, base);
    assert.equal(r.body.auth.state, 'optional');
    assert.equal(r.body.runtime.ok, true);
    assert.deepEqual(r.body.knownModels, ['gemma', 'llama3'], 'the status call already listed them');
    assert.equal(cfg.isConnected(), true);
    assert.equal(cfg.publicConfig().provider, 'compatible', 'the Coach is offered to users');

    r = await call('POST /api/admin/coach/models', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.models, ['gemma', 'llama3']);

    r = await call('POST /api/admin/coach/config', { model: 'llama3' });
    assert.equal(cfg.modelFor(), 'llama3');
  } finally { mock.close(); }
});

test('the disclosure names the provider and the same five categories the payload builds from', async () => {
  fresh({ provider: 'gemini' });
  const { call } = harness();
  const r = await call('GET /api/coach/disclosure');
  assert.equal(r.status, 200);
  assert.equal(r.body.providerLabel, 'Google Gemini');
  assert.deepEqual(r.body.categories, ['plan', 'training', 'bodyweight', 'profile', 'prefs']);
});

/* ---------- debrief + cohort routes ---------- */
test('a debrief is enqueued as its own kind, and the cohort routes gate on the admin switch and the opt-in', async () => {
  fresh({ community: false });
  const jobs = await import('../coach/jobs.js');
  const { writeState, sampleState } = await import('./helpers.mjs');
  const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
  forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
  writeState(process.env.DATA_DIR, 'admin-1', sampleState());
  const { call } = harness();

  const off = await call('GET /api/coach/cohort');
  assert.deepEqual(off.body, { ok: false, enabled: false });

  const cfgOn = await call('POST /api/admin/coach/config', { community: true });
  assert.equal(cfgOn.status, 200);
  assert.equal(cfg.load().community, true);
  assert.equal((await call('GET /api/admin/coach')).body.community, true);
  assert.equal(cfg.publicConfig().community, true);

  const notSharing = await call('GET /api/coach/cohort');
  assert.deepEqual(notSharing.body, { ok: false, enabled: true, sharing: false });
  const share = await call('POST /api/coach/cohort/share', { share: true });
  assert.deepEqual(share.body, { ok: true, sharing: true });
  assert.equal(jobs.isSharing('admin-1'), true);
  const alone = await call('GET /api/coach/cohort');
  assert.equal(alone.body.ok, false);
  assert.equal(alone.body.sharing, true);
  assert.equal(alone.body.people, 1);

  const r = await call('POST /api/coach/debrief', { workoutId: 'w1' });
  assert.equal(r.status, 202);
  assert.equal(jobs.status('admin-1').job.kind, 'debrief');
  const until = Date.now() + 15000;
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25));
  const s = jobs.status('admin-1');
  assert.equal(s.pending.kind, 'debrief');
  assert.deepEqual(s.pending.workout, { id: 'w1', d: '2026-07-20', name: 'Full body A', minutes: 45, vol: 600, sets: 3, prs: 0 });
  assert.equal(s.pending.score, 8);
  assert.ok(s.pending.summary.includes('3 sets'));
  assert.ok(Array.isArray(s.pending.nextTime) && s.pending.nextTime.length);
  assert.equal('changes' in s.pending, false);

  // A profile with nothing logged cannot be debriefed.
  jobs.resolvePending('admin-1', { accepted: ['debrief'] });
  writeState(process.env.DATA_DIR, 'admin-1', sampleState({ workouts: [] }));
  await call('POST /api/coach/debrief', {});
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25));
  assert.equal(jobs.status('admin-1').last.errorClass, 'noworkout');
});

/* ---------- configurable max message length (issue #267) ---------- */
test('an admin can raise the Coach message length past the old 1000-char default, clamped to a sane range', async () => {
  fresh();
  const { call } = harness();

  // A safe default for an instance that has never touched the setting.
  assert.equal((await call('GET /api/admin/coach')).body.maxMessageLen, 1000);

  const set = await call('POST /api/admin/coach/config', { maxMessageLen: 2500 });
  assert.equal(set.status, 200);
  assert.equal((await call('GET /api/admin/coach')).body.maxMessageLen, 2500);
  assert.equal(cfg.load().maxMessageLen, 2500, 'persists with the rest of the Coach config');

  // Clamped, not trusted outright — the admin route validates the same way `caps` does above.
  await call('POST /api/admin/coach/config', { maxMessageLen: 999999 });
  assert.equal((await call('GET /api/admin/coach')).body.maxMessageLen, 4000, 'ceiling');
  await call('POST /api/admin/coach/config', { maxMessageLen: 1 });
  assert.equal((await call('GET /api/admin/coach')).body.maxMessageLen, 200, 'floor');

  // The chat UI reads the limit off the status poll, not the admin card it cannot reach.
  await call('POST /api/admin/coach/config', { maxMessageLen: 1800 });
  const status = await call('GET /api/coach/status');
  assert.equal(status.body.maxMessageLen, 1800);
});

// The guard in front of every user route answers 503 while the Coach is switched off or has no
// provider connected. It sent the words with no class, so the app could not pick its own,
// translated line for it and a German lifter read "the Coach is not set up on this instance". It
// names the class now: 'off', the class enqueue's own refusal carries for the same state.
test('the Coach-off guard names its class beside the words, on every guarded user route', async () => {
  const guarded = ['GET /api/coach/status', 'POST /api/coach/plan', 'POST /api/coach/review', 'POST /api/coach/debrief',
    'GET /api/coach/cohort', 'POST /api/coach/cohort/share', 'POST /api/coach/pending/resolve'];
  const refusal = { error: 'the Coach is not set up on this instance', code: 'off' };
  const { call } = harness();
  for (const [state, patch] of [['switched off', { enabled: false }], ['no provider connected', { provider: 'anthropic' }]]) {
    fresh(patch);
    assert.equal(cfg.isConnected(), false, state);
    for (const key of guarded) {
      const r = await call(key, {});
      assert.equal(r.status, 503, `${state}: ${key}`);
      assert.deepEqual(r.body, refusal, `${state}: ${key}`);
    }
  }
});

/* ---------- configurable max output tokens (reasoning models) ---------- */
test('an admin can raise the Coach output cap for a reasoning model, clamped to a sane range', async () => {
  fresh();
  const { call } = harness();

  // The old hard-coded constant, for an instance that has never touched the setting.
  assert.equal((await call('GET /api/admin/coach')).body.maxOutputTokens, 16000);

  const set = await call('POST /api/admin/coach/config', { maxOutputTokens: 48000 });
  assert.equal(set.status, 200);
  assert.equal((await call('GET /api/admin/coach')).body.maxOutputTokens, 48000);
  assert.equal(cfg.load().maxOutputTokens, 48000, 'persists with the rest of the Coach config');

  // Clamped, not trusted outright — a reasoning model needs more than 16000, but not a million.
  await call('POST /api/admin/coach/config', { maxOutputTokens: 999999 });
  assert.equal((await call('GET /api/admin/coach')).body.maxOutputTokens, 65536, 'ceiling');
  await call('POST /api/admin/coach/config', { maxOutputTokens: 1 });
  assert.equal((await call('GET /api/admin/coach')).body.maxOutputTokens, 1024, 'floor');
});

/* ---------- compatible extra headers (issue #385) ---------- */
test('an admin can store extra headers for the compatible endpoint; framing names are refused', async () => {
  fresh();
  const { call } = harness();

  // Empty by default.
  assert.equal((await call('GET /api/admin/coach')).body.headers, null);

  let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: 'http://127.0.0.1:9', headers: { 'x-opencode-session': 'sess-1' } });
  assert.equal(r.status, 200);
  assert.deepEqual((await call('GET /api/admin/coach')).body.headers, { 'x-opencode-session': 'sess-1' });
  assert.deepEqual(cfg.load().providerOptions.compatible.headers, { 'x-opencode-session': 'sess-1' }, 'persists with the rest of the Coach config');

  // Reserved framing names are refused, and a fixed-endpoint provider takes none.
  r = await call('POST /api/admin/coach/config', { headers: { authorization: 'Bearer x' } });
  assert.equal(r.status, 400);
  r = await call('POST /api/admin/coach/config', { provider: 'openai', headers: { 'x-a': 'b' } });
  assert.equal(r.status, 400);

  // Clearing with null drops the key rather than storing an empty map.
  r = await call('POST /api/admin/coach/config', { provider: 'compatible', headers: null });
  assert.equal(r.status, 200);
  assert.equal((await call('GET /api/admin/coach')).body.headers, null);
  assert.equal('headers' in cfg.load().providerOptions.compatible, false);
});
