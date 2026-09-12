/* The admin routes, driven with fake server helpers — the layer between the card and the
 * config store, which learned per-provider keys, a base URL, a model list and the "this
 * provider spawns nothing" report. The user routes are exercised through jobs.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData } from './helpers.mjs';
import { socialRoutes } from '../social/routes.js';
import { accountView, profileRoutes } from '../profile.js';

function socialHarness() {
  const users = [{ id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob', avatar: 'data:image/jpeg;base64,/9j/2Q==' },
    { id: 'eve', name: 'Eve', avatar: 'data:image/jpeg;base64,/9j/2Q==' }];
  let data = { connections: [], plans: [] };
  const routes = socialRoutes({
    json: (res, status, body) => Object.assign(res, { status, body }),
    readBody: async req => req.body,
    readSession: req => users.find(u => u.id === req.user && !u.disabled),
    users: () => users,
    readState: () => ({ unit: 'kg', week: { 1: ['push'] }, routines: [{ id: 'push', name: 'Push',
      ex: [{ id: 'bench', sets: 3, reps: 5, weight: 60, note: 'private routine note' }] }],
    workouts: [{ id: 'w1', d: '2026-09-07', bw: 80, note: 'private workout note',
      entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] },
        ...Array.from({ length: 13 }, (_, i) => ({ id: `exercise-${i}`, sets: [{ w: 10 + i, r: 5, done: true }] }))] }],
    bodyweight: [{ d: '2026-09-06', w: 80 }] }),
    load: () => structuredClone(data), save: next => { data = next; },
    userNow: () => ({ date: '2026-09-11' })
  });
  return { users, call: async (key, user = 'alice', body = {}, query = '') => {
    const res = {};
    await routes[key]({ user, body, url: key.split(' ')[1] + query }, res);
    return res;
  } };
}

test('social requests require acceptance, reveal only summaries, and are revoked on removal', async () => {
  const { call } = socialHarness();
  assert.equal((await call('GET /api/social', null)).status, 401);
  const bob = await call('GET /api/social', 'bob');
  assert.deepEqual(bob.body.suggestions, [{ id: 'alice', name: 'Alice' }, { id: 'eve', name: 'Eve' }]);
  assert.deepEqual((await call('GET /api/social/counts', 'bob')).body, { incoming: 0, plans: 0, total: 0 });
  assert.equal((await call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 200);
  assert.equal((await call('POST /api/social/request', 'alice', { userId: 'bob' })).status, 409);
  assert.equal((await call('POST /api/social/request', 'bob', { userId: 'bob' })).status, 400);
  assert.equal((await call('POST /api/social/request', 'alice', { userId: 'invalid' })).status, 404);
  const pending = (await call('GET /api/social', 'bob')).body;
  assert.deepEqual(pending.incoming, [{ id: 'alice', name: 'Alice' }]);
  assert.deepEqual(pending.friends, []);
  assert.deepEqual(pending.suggestions, [{ id: 'eve', name: 'Eve' }]);
  assert.deepEqual((await call('GET /api/social/counts', 'bob')).body, { incoming: 1, plans: 0, total: 1 });
  assert.equal((await call('GET /api/social/profile', 'alice', {}, '?id=bob')).status, 404);
  assert.equal((await call('POST /api/social/accept', 'alice', { userId: 'bob' })).status, 404);
  assert.equal((await call('POST /api/social/accept', 'eve', { userId: 'alice' })).status, 404);
  assert.equal((await call('POST /api/social/accept', 'bob', { userId: 'alice' })).status, 200);
  const friends = (await call('GET /api/social', 'alice')).body.friends;
  assert.equal(friends[0].id, 'bob');
  assert.equal(friends[0].avatar, 'data:image/jpeg;base64,/9j/2Q==');
  assert.equal(friends[0].weekStreak, 1);
  assert.equal(friends[0].records[0].value, 60);
  assert.equal(friends[0].records.length, 12);
  assert.ok(!JSON.stringify(friends).includes('private'));
  const profile = (await call('GET /api/social/profile', 'alice', {}, '?id=bob')).body;
  assert.equal(profile.bodyWeight.value, 80);
  assert.equal(profile.bodyWeightShared, true);
  assert.equal(profile.avatar, 'data:image/jpeg;base64,/9j/2Q==');
  assert.equal(profile.thisMonth, 1);
  assert.equal(profile.records[0].exerciseId, 'bench');
  assert.equal(profile.records.length, 14);
  assert.equal(profile.plan.routines[0].name, 'Push');
  assert.ok(!JSON.stringify(profile).includes('private'));
  assert.equal((await call('GET /api/social/profile', 'eve', {}, '?id=bob')).status, 404);
  assert.equal((await call('GET /api/social', 'eve')).body.friends.length, 0);
  await call('POST /api/social/remove', 'bob', { userId: 'alice' });
  assert.deepEqual((await call('GET /api/social', 'alice')).body.friends, []);
  assert.deepEqual((await call('GET /api/social', 'bob')).body.friends, []);
});

test('friend body weight follows the profile privacy choice', async () => {
  const { call, users } = socialHarness();
  await call('POST /api/social/request', 'alice', { userId: 'bob' });
  await call('POST /api/social/accept', 'bob', { userId: 'alice' });
  users.find(user => user.id === 'bob').shareBodyWeight = false;
  const profile = (await call('GET /api/social/profile', 'alice', {}, '?id=bob')).body;
  assert.equal(profile.bodyWeightShared, false);
  assert.equal(profile.bodyWeight, null);
});

test('profile updates validate the name and raster avatar before saving', async () => {
  const users = [{ id: 'alice', name: 'Alice' }];
  let saves = 0;
  const routes = profileRoutes({
    json: (res, status, body) => Object.assign(res, { status, body }),
    readBody: async req => req.body,
    readSession: req => users.find(user => user.id === req.user),
    save: () => { saves++; },
    isAdmin: () => false
  });
  const call = async (user, body) => {
    const res = {};
    await routes['POST /api/profile']({ user, body }, res);
    return res;
  };
  assert.equal((await call(null, {})).status, 401);
  assert.equal((await call('alice', {})).status, 400);
  assert.equal((await call('alice', { name: '   ' })).status, 400);
  assert.equal((await call('alice', { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  const changed = await call('alice', {
    name: '  Alice Strong  ', avatar: 'data:image/jpeg;base64,/9j/2Q==', shareBodyWeight: false
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.user, {
    id: 'alice', name: 'Alice Strong', admin: false,
    avatar: 'data:image/jpeg;base64,/9j/2Q==', shareBodyWeight: false
  });
  assert.equal(saves, 1);
  const cleared = await call('alice', { avatar: null });
  assert.equal(cleared.body.user.avatar, null);
  assert.equal(saves, 2);
  assert.deepEqual(accountView({ id: 'legacy', name: 'Legacy' }, () => false), {
    id: 'legacy', name: 'Legacy', admin: false, avatar: null, shareBodyWeight: true
  });
});

test('plan snapshots are available only to the intended friend and disappear after dismissal or removal', async () => {
  const { call, users } = socialHarness();
  const plan = { opengym_plan: 1, name: 'Push', unit: 'kg', week: { 1: ['r1'] }, customEx: [],
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench', sets: 3, reps: 5, weight: 60 }] }] };
  assert.equal((await call('POST /api/social/plan', 'alice', { userId: 'bob', plan })).status, 403);
  await call('POST /api/social/request', 'alice', { userId: 'bob' });
  await call('POST /api/social/accept', 'bob', { userId: 'alice' });
  assert.equal((await call('POST /api/social/plan', 'alice', { userId: 'bob', plan: {} })).status, 400);
  assert.equal((await call('POST /api/social/plan', 'alice', { userId: 'bob', plan })).status, 200);
  let id = (await call('GET /api/social', 'bob')).body.plans[0].id;
  assert.equal((await call('GET /api/social/plan', 'eve', {}, '?id=' + id)).status, 404);
  assert.equal((await call('GET /api/social/plan', 'alice', {}, '?id=' + id)).status, 404);
  assert.deepEqual((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).body.plan, plan);
  await call('POST /api/social/plan/dismiss', 'eve', { id });
  assert.equal((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).status, 200);
  await call('POST /api/social/plan', 'alice', { userId: 'bob', plan: { ...plan, name: 'Updated push' } });
  assert.equal((await call('GET /api/social', 'bob')).body.plans.length, 1);
  assert.equal((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).status, 404);
  id = (await call('GET /api/social', 'bob')).body.plans[0].id;
  users[0].disabled = true;
  assert.deepEqual((await call('GET /api/social', 'bob')).body.plans, []);
  assert.deepEqual((await call('GET /api/social', 'bob')).body.friends, []);
  assert.equal((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).status, 404);
  users[0].disabled = false;
  await call('POST /api/social/plan/dismiss', 'bob', { id });
  assert.equal((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).status, 404);
  await call('POST /api/social/plan', 'alice', { userId: 'bob', plan });
  id = (await call('GET /api/social', 'bob')).body.plans[0].id;
  await call('POST /api/social/remove', 'bob', { userId: 'alice' });
  assert.equal((await call('GET /api/social/plan', 'bob', {}, '?id=' + id)).status, 404);
});

tempData();
const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');

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
