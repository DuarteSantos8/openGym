/* Strava as an integrations provider (integrations/providers/strava.js): the OAuth round trip
 * through the hub, a finished workout going up once as a Weight Training activity, token
 * refresh, a revoked connection asking to be connected again, and the redirect routes. Strava
 * itself is a fake fetch, so nothing here leaves the machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIntegrations, enabledIds } from '../integrations/index.js';
import { integrationRoutes } from '../integrations/routes.js';
import { activityFor } from '../integrations/providers/strava.js';

const SECRET = 'b'.repeat(64);
const NOW = Date.UTC(2026, 10, 10, 18, 0, 0);
const ORIGIN = 'https://gym.example.com';
const ENV = { INTEGRATIONS: 'strava', STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'shh' };

function rig(env = ENV) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-strava-'));
  const calls = [];
  let t = NOW, n = 0;
  const strava = { refresh: () => ({ status: 200 }), activity: () => ({ status: 201, body: { id: 900 + n } }), athlete: () => ({ status: 200, body: { id: 7 } }) };
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: init.headers?.Authorization || null });
    n++;
    let a;
    if (url.endsWith('/oauth/token')) {
      a = body.grant_type === 'refresh_token' ? strava.refresh(body) : { status: 200 };
      if (a.status === 200 && !a.body) a = { status: 200, body: { access_token: 'acc-' + n, refresh_token: 'ref-' + n, expires_at: Math.floor(t / 1000) + 21600, athlete: { id: 7, firstname: 'Dana', lastname: 'H' } } };
    } else a = url.endsWith('/athlete') ? strava.athlete() : strava.activity(body);
    if (a instanceof Error) throw a;
    return { status: a.status, ok: a.status < 300, json: async () => a.body || {} };
  };
  const hub = createIntegrations({ dataDir, secret: SECRET, env, now: () => t, origin: ORIGIN + '/', fetchImpl });
  const stateOf = url => new URL(url).searchParams.get('state');
  const connect = async (uid = 'u1') => hub.oauthCallback(uid, { code: 'c', scope: 'read,activity:write', state: stateOf(hub.authorize(uid, 'strava')) });
  const posts = () => calls.filter(c => c.url.endsWith('/activities'));
  return { hub, calls, strava, dataDir, connect, posts, stateOf, tick: ms => { t += ms; }, now: () => t };
}

const W = (id, end, over = {}) => ({
  id, d: '2026-11-10', name: 'Push day', start: end - 50 * 60000, end, prs: ['0025'],
  entries: [{ id: 'mine', sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] }],
  ...over,
});
const DOC = ws => ({ unit: 'kg', customEx: [{ id: 'mine', name: 'Bench Press' }], workouts: ws });

test('Strava is off without INTEGRATIONS=strava, and without its two keys', () => {
  assert.deepEqual(enabledIds({ INTEGRATIONS: 'webhook, strava' }, ['webhook', 'strava']), ['webhook', 'strava']);
  const noKeys = rig({ INTEGRATIONS: 'strava' });
  assert.equal(noKeys.hub.publicConfig(), null);
  assert.throws(() => noKeys.hub.authorize('u1', 'strava'), e => e.status === 404);
  const webhookOnly = rig({ ...ENV, INTEGRATIONS: 'webhook' });
  assert.deepEqual(webhookOnly.hub.publicConfig(), { providers: ['webhook'] });
  assert.throws(() => webhookOnly.hub.authorize('u1', 'strava'), e => e.status === 404 && e.code === 'missing');
  assert.throws(() => webhookOnly.hub.authorize('u1', 'webhook'), e => e.status === 404, 'a webhook has no sign-in');
});

test('the consent link asks for upload only and comes back to this server', () => {
  const r = rig();
  const u = new URL(r.hub.authorize('u1', 'strava'));
  assert.equal(u.origin + u.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(u.searchParams.get('scope'), 'activity:write');
  assert.equal(u.searchParams.get('client_id'), '123');
  assert.equal(u.searchParams.get('redirect_uri'), ORIGIN + '/api/integrations/oauth/callback');
  assert.equal(r.hub.stateProvider(u.searchParams.get('state')), 'strava');
  assert.deepEqual(r.hub.describe('u1').providers, [{ id: 'strava', kind: 'oauth', category: 'training', events: ['workout.finished'], max: 1 }]);
});

test('a callback is refused for another profile, a late or forged state, a cancel and a missing scope', async () => {
  const r = rig();
  const state = r.stateOf(r.hub.authorize('u1', 'strava'));
  const ok = { code: 'c', scope: 'read,activity:write', state };
  await assert.rejects(r.hub.oauthCallback('u2', ok), e => e.code === 'state');
  await assert.rejects(r.hub.oauthCallback('u1', { ...ok, state: state.slice(0, -2) + 'xx' }), e => e.code === 'state');
  await assert.rejects(r.hub.oauthCallback('u1', { ...ok, error: 'access_denied' }), e => e.code === 'denied');
  await assert.rejects(r.hub.oauthCallback('u1', { ...ok, scope: 'read' }), e => e.code === 'scope');
  assert.equal(r.calls.length, 0, 'no code was traded');
  r.tick(11 * 60000);
  await assert.rejects(r.hub.oauthCallback('u1', ok), e => e.code === 'state');
  assert.equal(r.hub.describe('u1').connections.length, 0);
});

test('connecting stores the athlete, and the tokens only sealed', async () => {
  const r = rig();
  const made = await r.connect();
  assert.equal(made.provider, 'strava');
  assert.equal(made.connection.label, 'Dana H');
  assert.equal(made.connection.status, 'connected');
  assert.deepEqual(made.connection.events, ['workout.finished']);
  assert.equal(made.connection.info.athlete, 'Dana H');
  assert.deepEqual(r.calls[0].body, { client_id: '123', client_secret: 'shh', grant_type: 'authorization_code', code: 'c' });
  const disk = fs.readFileSync(path.join(r.dataDir, 'integrations', 'u-u1.json'), 'utf8');
  assert.ok(!disk.includes('acc-') && !disk.includes('ref-'), 'no token in the clear');
  assert.ok(!JSON.stringify(r.hub.describe('u1')).includes('acc-'));
  assert.throws(() => r.hub.connect('u1', 'strava', {}), e => e.status === 409 || e.code === 'oauth', 'no form to connect with');
});

test('a finished workout goes up once, as a Weight Training activity with its sets', async () => {
  const r = rig();
  await r.connect();
  r.tick(60000);
  const before = W('old', NOW - 3 * 86400000);          // finished before Strava was connected
  const w = W('w1', r.now());
  assert.equal(r.hub.onStateWrite('u1', DOC([]), DOC([before, w])), 1);
  assert.equal(r.hub.onStateWrite('u1', DOC([]), DOC([before, w])), 0, 'a second device pushing the same workout');
  await r.hub._outbox().run();
  assert.equal(r.posts().length, 1);
  const a = r.posts()[0];
  assert.match(a.auth, /^Bearer acc-/);
  assert.equal(a.body.sport_type, 'WeightTraining');
  assert.equal(a.body.name, 'Push day');
  assert.equal(a.body.elapsed_time, 50 * 60);
  assert.equal(a.body.start_date_local, new Date(w.start).toISOString());
  assert.match(a.body.description, /^2 sets · 1,080 kg volume · 1 PR\n/);
  assert.match(a.body.description, /Bench Press: 60kg×10, 60kg×8/);
  assert.match(a.body.description, /Logged with openGym$/);
  const c = r.hub.describe('u1').connections[0];
  assert.equal(c.status, 'connected');
  assert.equal(c.lastOk, r.now());
  assert.equal(r.hub.log('u1', c.id).log[0].ev, 'workout.finished');
});

test('side-by-side, timed and bodyweight sets are described; a long log is cut', () => {
  const a = activityFor({ unit: 'lb', totals: { sets: 3 }, exercises: [
    { name: 'Curl', sets: [{ sides: { left: { weight: 20, reps: 10 }, right: { weight: 20, reps: 9 } } }] },
    { name: 'Plank', sets: [{ seconds: 45 }] },
    { name: 'Pull-up', sets: [{ reps: 12 }] },
    { name: 'Skipped', sets: [] },
  ] });
  assert.match(a.description, /Curl: L 20lb×10 \/ R 20lb×9/);
  assert.match(a.description, /Plank: 45s/);
  assert.match(a.description, /Pull-up: 12/);
  assert.doesNotMatch(a.description, /Skipped/);
  assert.equal(a.name, 'Strength workout');
  assert.equal(a.elapsed_time, 60);
  const long = activityFor({ exercises: Array.from({ length: 60 }, (_, i) => ({ name: 'Exercise number ' + i, sets: Array(10).fill({ weight: 100, reps: 10 }) })) });
  assert.equal(long.description.length, 2000);
});

test('an expired access token is refreshed and the new pair kept', async () => {
  const r = rig();
  await r.connect();
  r.tick(7 * 3600_000);                                  // past the six hours a token lasts
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w1', r.now())]));
  await r.hub._outbox().run();
  const refresh = r.calls.find(c => c.body?.grant_type === 'refresh_token');
  assert.equal(refresh.body.refresh_token, 'ref-1');
  assert.equal(r.posts().length, 1);
  assert.notEqual(r.posts()[0].auth, 'Bearer acc-1');
  // The next one uses what was kept, without asking again.
  r.tick(60000);
  r.hub.onStateWrite('u1', DOC([W('w1', 0)]), DOC([W('w1', 0), W('w2', r.now())]));
  await r.hub._outbox().run();
  assert.equal(r.calls.filter(c => c.body?.grant_type === 'refresh_token').length, 1);
  assert.equal(r.posts()[1].auth, r.posts()[0].auth);
});

test('two uploads at once share one refresh, and a token Strava refuses is replaced once', async () => {
  const r = rig();
  await r.connect();
  r.tick(7 * 3600_000);
  // Strava rotates the refresh token: the old one works exactly once.
  const used = new Set();
  r.strava.refresh = body => (used.has(body.refresh_token) ? { status: 400, body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } } : (used.add(body.refresh_token), { status: 200 }));
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w1', r.now() - 1000), W('w2', r.now())]));
  await r.hub._outbox().run();                            // the outbox sends two at a time
  const refreshes = () => r.calls.filter(c => c.body?.grant_type === 'refresh_token');
  assert.equal(refreshes().length, 1);
  assert.equal(r.posts().length, 2);
  assert.equal(r.posts()[0].auth, r.posts()[1].auth);
  assert.equal(r.hub.describe('u1').connections[0].status, 'connected');
  // Strava refuses the stored token before its time is up: one new token, with the refresh
  // token the last refresh stored, and the upload goes through.
  r.tick(60000);
  const dead = r.posts()[0].auth;
  r.strava.activity = () => ({ status: r.calls.at(-1).auth === dead ? 401 : 201, body: { id: 1 } });
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w3', r.now())]));
  await r.hub._outbox().run();
  assert.equal(refreshes().length, 2);
  assert.notEqual(refreshes()[1].body.refresh_token, refreshes()[0].body.refresh_token, 'the rotated refresh token, not the one read before');
  assert.equal(r.posts().length, 4);
  assert.equal(r.hub.describe('u1').connections[0].status, 'connected');
});

test('a connection Strava revoked needs attention, and connecting again renews it in place', async () => {
  const r = rig();
  const id = (await r.connect()).connection.id;
  r.tick(7 * 3600_000);
  r.strava.refresh = () => ({ status: 400, body: { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] } });
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w1', r.now())]));
  await r.hub._outbox().run();
  let c = r.hub.describe('u1').connections[0];
  assert.equal(c.status, 'attention');
  assert.equal(c.paused, true);
  assert.equal(c.lastError.code, 'reconnect');
  assert.equal(r.posts().length, 0);
  r.strava.refresh = () => ({ status: 200 });
  const again = await r.connect();
  assert.equal(again.renewed, true);
  assert.equal(again.connection.id, id, 'the same connection, so nothing already sent goes up twice');
  c = r.hub.describe('u1').connections;
  assert.equal(c.length, 1);
  assert.equal(c[0].status, 'connected');
  // What failed is still there to retry, now with tokens that work.
  await r.hub.retry('u1', id);
  assert.equal(r.posts().length, 1);
});

test('wrong application keys on the server do not pause anyone, and uploads resume once they are fixed', async () => {
  const r = rig();
  const id = (await r.connect()).connection.id;
  r.tick(7 * 3600_000);
  r.strava.refresh = () => ({ status: 401, body: { message: 'Authorization Error', errors: [{ resource: 'Application', field: 'client_secret', code: 'invalid' }] } });
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w1', r.now())]));
  await r.hub._outbox().run();
  let c = r.hub.describe('u1').connections[0];
  assert.equal(c.paused, false);
  assert.equal(c.status, 'connected', 'not asked to sign in again');
  assert.equal(c.lastError.code, 'app');
  assert.deepEqual(r.hub._outbox().counts('u1', id), { queued: 1, failed: 0 });
  // An answer that names neither is a plain refusal: failed, there to retry, still not paused.
  r.strava.refresh = () => ({ status: 400, body: { message: 'Bad Request' } });
  r.tick(2 * 3600_000);
  await r.hub._outbox().run();
  c = r.hub.describe('u1').connections[0];
  assert.equal(c.paused, false);
  assert.deepEqual(r.hub._outbox().counts('u1', id), { queued: 0, failed: 1 });
  r.strava.refresh = () => ({ status: 200 });
  await r.hub.retry('u1', id);
  assert.equal(r.posts().length, 1);
  assert.equal(r.hub.describe('u1').connections[0].status, 'connected');
});

test('Strava being busy is retried later; a refusal is not', async () => {
  const r = rig();
  const id = (await r.connect()).connection.id;
  r.tick(60000);
  r.strava.activity = () => ({ status: 429, body: {} });
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w1', r.now())]));
  await r.hub._outbox().run();
  assert.deepEqual(r.hub._outbox().counts('u1', id), { queued: 1, failed: 0 });
  assert.ok(r.hub._outbox().snapshot().jobs[0].nextAt - r.now() >= 15 * 60000, 'waits out the rate-limit window');
  r.strava.activity = () => ({ status: 400, body: { message: 'Bad Request' } });
  r.tick(16 * 60000);
  await r.hub._outbox().run();
  assert.deepEqual(r.hub._outbox().counts('u1', id), { queued: 0, failed: 1 });
  r.strava.activity = () => new Error('socket hang up');
  r.hub.onStateWrite('u1', DOC([]), DOC([W('w2', r.now())]));
  await r.hub._outbox().run();
  assert.equal(r.hub._outbox().counts('u1', id).queued, 1, 'no answer at all is tried again');
});

test('the test button checks the connection without creating an activity; disconnect never calls Strava', async () => {
  const r = rig();
  const id = (await r.connect()).connection.id;
  const res = await r.hub.test('u1', id);
  assert.equal(res.ok, true);
  assert.equal(r.posts().length, 0);
  assert.ok(r.calls.at(-1).url.endsWith('/api/v3/athlete'));
  assert.deepEqual(r.hub.update('u1', id, { paused: true, label: 'x', events: [] }).connection.label, 'Dana H');
  const before = r.calls.length;
  r.hub.disconnect('u1', id);
  assert.equal(r.calls.length, before, 'no deauthorize: it would revoke the application for every tool that shares it');
  assert.equal(r.hub.describe('u1').connections.length, 0);
});

test('the routes: page loads that redirect to Strava and back into the app', async () => {
  const r = rig();
  let session = { id: 'u1' };
  const audits = [];
  const routes = integrationRoutes({ json: () => { throw new Error('these answer with redirects'); }, readBody: async () => ({}), readSession: () => session, hub: r.hub, audit: (req, ev, f) => audits.push([ev, f.msg]) });
  const get = async (key, url) => { let to = null; await routes[key]({ url }, { writeHead: (code, h) => { assert.equal(code, 302); to = h.Location; }, end() {} }); return to; };
  const back = (result, provider = 'strava') => `${ORIGIN}/#/settings/integrations?oauth=${provider}&result=${result}`;

  const consent = await get('GET /api/integrations/oauth/authorize', '/api/integrations/oauth/authorize?provider=strava');
  assert.match(consent, /^https:\/\/www\.strava\.com\/oauth\/authorize\?/);
  const state = encodeURIComponent(r.stateOf(consent));
  assert.equal(await get('GET /api/integrations/oauth/authorize', '/api/integrations/oauth/authorize?provider=nope'), back('off', 'nope'));
  assert.equal(await get('GET /api/integrations/oauth/authorize', '/api/integrations/oauth/authorize?provider=%3Cscript%3E'), back('off', 'unknown'));

  const cb = q => get('GET /api/integrations/oauth/callback', '/api/integrations/oauth/callback?' + q);
  assert.equal(await cb(`error=access_denied&state=${state}`), back('denied'));
  assert.equal(await cb(`code=c&scope=read&state=${state}`), back('scope'));
  assert.equal(await cb('code=c&scope=activity:write&state=forged.state'), back('error', 'unknown'));
  session = { id: 'u2' };
  assert.equal(await cb(`code=c&scope=activity:write&state=${state}`), back('error'));
  session = null;
  assert.equal(await cb(`code=c&scope=activity:write&state=${state}`), back('signin'));
  assert.equal(await get('GET /api/integrations/oauth/authorize', '/api/integrations/oauth/authorize?provider=strava'), back('signin'));
  session = { id: 'u1' };
  assert.equal(await cb(`code=c&scope=read,activity:write&state=${state}`), back('connected'));
  assert.deepEqual(audits, [['integration.connect', 'strava: Dana H']]);
  assert.equal(r.hub.describe('u1').connections[0].label, 'Dana H');
});
