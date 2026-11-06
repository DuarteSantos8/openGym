/* Strava (integrations/providers/strava.js, #478): off without its app's credentials, the OAuth
 * round trip with its state bound to the profile and used once, the activity a workout becomes,
 * the token refresh, and what a refusal does. All against a pretend Strava: nothing leaves the
 * machine, and no real Strava app was needed to write these (a real one needs Strava's review to
 * take more than one athlete). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createIntegrations, OAUTH_STATE_MS } = await import('../integrations/index.js');
const { activityFor, sportOf, AUTHORIZE_URL, TOKEN_URL, ACTIVITY_URL } = await import('../integrations/providers/strava.js');
const { workoutPayload } = await import('../integrations/events.js');

const SECRET = 'b'.repeat(64);
const ENV = { INTEGRATIONS: 'strava', STRAVA_CLIENT_ID: '4242', STRAVA_CLIENT_SECRET: 'shh' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-strava-'));

// A pretend Strava: the token endpoint and the activity endpoint, with switches for refusals.
function strava() {
  const s = { calls: [], activities: [], codes: new Map([['good', 'r1']]), refresh: new Map([['r1', true]]), access: new Set(), n: 0, activityStatus: 201 };
  s.fetchFn = async (url, { method, headers, body }) => {
    const form = Object.fromEntries(new URLSearchParams(body));
    s.calls.push({ url, method, form, auth: headers.Authorization || null });
    const reply = (status, data) => ({ status, json: async () => data });
    if (url === TOKEN_URL) {
      if (form.client_id !== '4242' || form.client_secret !== 'shh') return reply(401, { message: 'Bad client' });
      if (form.grant_type === 'authorization_code') {
        if (!s.codes.has(form.code)) return reply(400, { message: 'Bad code' });
        const a = 'a' + (++s.n); s.access.add(a);
        return reply(200, { access_token: a, refresh_token: s.codes.get(form.code), expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 7, firstname: 'Ana', lastname: 'Lift' } });
      }
      if (form.grant_type === 'refresh_token') {
        if (!s.refresh.get(form.refresh_token)) return reply(400, { message: 'Bad refresh' });
        const a = 'a' + (++s.n); s.access.add(a);
        return reply(200, { access_token: a, refresh_token: form.refresh_token, expires_at: Math.floor(Date.now() / 1000) + 21600 });
      }
    }
    if (url === ACTIVITY_URL) {
      const tok = (headers.Authorization || '').replace('Bearer ', '');
      if (!s.access.has(tok)) return reply(401, { message: 'Authorization Error' });
      if (s.activityStatus !== 201) return reply(s.activityStatus, {});
      s.activities.push(form);
      return reply(201, { id: s.activities.length });
    }
    return reply(404, {});
  };
  return s;
}

function hub(env = ENV, s = strava(), now = Date.now) {
  const h = createIntegrations({ dataDir: tmp(), secret: SECRET, env, fetchFn: s.fetchFn, now });
  return { h, s };
}
const stateOf = url => new URL(url).searchParams.get('state');
async function connect(h, uid = 'u1') {
  const url = h.oauthStart(uid, 'strava', 'https://gym.example.com/api/integrations/oauth/callback');
  return h.oauthFinish({ state: stateOf(url), code: 'good', scope: 'read,activity:write' }, uid);
}
// Finished "after connecting": a little in the future, which the hub takes up to a day ahead.
const NOW = Date.now();
const cardio = { id: 'w1', d: new Date(NOW).toISOString().slice(0, 10), name: 'Morning run', start: NOW + 25 * 60000, end: NOW + 60 * 60000,
  entries: [{ id: 'treadmill-run', sets: [{ min: 30, speed: 10, incline: 1, done: true }, { min: 5, speed: 6, done: true }] }] };
const lifting = { id: 'w2', d: cardio.d, name: 'Push', start: NOW + 10 * 60000, end: NOW + 70 * 60000,
  entries: [{ id: '0025', sets: [{ w: 20, r: 10, phase: 'warmup', done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }] }], prs: ['0025'] };
const doc = { unit: 'kg', customEx: [{ id: 'treadmill-run', name: 'Treadmill run' }], workouts: [] };

test('off without the app’s credentials, or without strava in INTEGRATIONS', () => {
  assert.equal(createIntegrations({ dataDir: tmp(), secret: SECRET, env: { INTEGRATIONS: 'strava' } }).active, false);
  assert.equal(createIntegrations({ dataDir: tmp(), secret: SECRET, env: { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: '2' } }).active, false);
  const { h } = hub();
  assert.deepEqual(h.publicConfig(), { providers: ['strava'] });
  assert.equal(h.describe('u1').providers[0].kind, 'oauth');
  assert.throws(() => h.connect('u1', 'strava', {}), e => e.code === 'oauth');
});

test('the sign-in: Strava’s page with our state, then the tokens sealed and the athlete named', async () => {
  const { h, s } = hub();
  const url = new URL(h.oauthStart('u1', 'strava', 'https://gym.example.com/api/integrations/oauth/callback'));
  assert.equal(url.origin + url.pathname, AUTHORIZE_URL);
  assert.equal(url.searchParams.get('client_id'), '4242');
  assert.equal(url.searchParams.get('scope'), 'activity:write');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://gym.example.com/api/integrations/oauth/callback');
  const out = await h.oauthFinish({ state: url.searchParams.get('state'), code: 'good', scope: 'read,activity:write' }, 'u1');
  assert.equal(out.uid, 'u1');
  assert.equal(out.connection.label, 'Ana Lift');
  assert.equal(out.connection.info.strength, 'off');
  const rec = h._store().get('u1', out.connection.id);
  assert.ok(!JSON.stringify(rec.secrets).includes('a1') || rec.secrets.access.startsWith('v1.'), 'sealed');
  assert.equal(s.calls.filter(c => c.url === TOKEN_URL).length, 1);
});

test('the state: bound to its profile, its ten minutes and one use; the scope has to be granted', async () => {
  let clock = Date.now();
  const { h } = hub(ENV, strava(), () => clock);
  const cb = 'https://gym.example.com/api/integrations/oauth/callback';
  const st = stateOf(h.oauthStart('u1', 'strava', cb));
  await assert.rejects(h.oauthFinish({ state: st, code: 'good', scope: 'activity:write' }, 'u2'), e => e.status === 403);
  await assert.rejects(h.oauthFinish({ state: st.slice(0, -2) + 'xx', code: 'good', scope: 'activity:write' }, 'u1'), e => e.code === 'state');
  const ok = await h.oauthFinish({ state: st, code: 'good', scope: 'activity:write' }, null);   // no cookie: the state names the profile
  assert.equal(ok.uid, 'u1');
  await assert.rejects(h.oauthFinish({ state: st, code: 'good', scope: 'activity:write' }, 'u1'), e => /used/.test(e.message), 'once');
  const late = stateOf(h.oauthStart('u1', 'strava', cb));
  clock += OAUTH_STATE_MS + 1;
  await assert.rejects(h.oauthFinish({ state: late, code: 'good', scope: 'activity:write' }, 'u1'), e => e.code === 'state');
  const noScope = stateOf(h.oauthStart('u1', 'strava', cb));
  await assert.rejects(h.oauthFinish({ state: noScope, code: 'good', scope: 'read' }, 'u1'), e => e.code === 'scope');
  const denied = stateOf(h.oauthStart('u1', 'strava', cb));
  await assert.rejects(h.oauthFinish({ state: denied, error: 'access_denied' }, 'u1'), e => e.code === 'denied');
  // a second sign-in replaces the first
  await connect(h)
  assert.equal(h.describe('u1').connections.length, 1);
});

test('a workout as an activity: cardio as what it was, strength only when asked', () => {
  const run = activityFor(workoutPayload(cardio, doc));
  assert.equal(run.sport_type, 'Run');
  assert.equal(run.trainer, 1);
  assert.equal(run.elapsed_time, 35 * 60);
  assert.equal(run.distance, 5500);
  assert.equal(run.name, 'Morning run');
  assert.match(run.description, /^Treadmill run: 30 min · 5 km · 1%, 5 min · 0\.5 km/);
  assert.equal(activityFor(workoutPayload(lifting, doc)), null, 'strength is off by default');
  const lift = activityFor(workoutPayload(lifting, doc), { strength: true });
  assert.equal(lift.sport_type, 'WeightTraining');
  assert.equal(lift.elapsed_time, 60 * 60);
  assert.match(lift.description, /60 kg × 8, 60 kg × 7/);
  assert.ok(!/20 kg × 10/.test(lift.description), 'warm-ups left out');
  assert.match(lift.description, /PRs: /);
  assert.equal(lift.distance, undefined);
  assert.deepEqual(sportOf('Rowing machine'), { sport: 'Rowing', trainer: true });
  assert.deepEqual(sportOf('Outdoor running'), { sport: 'Run', trainer: false });
  assert.deepEqual(sportOf('Stationary bike'), { sport: 'Ride', trainer: true });
  assert.equal(sportOf('Mystery').sport, 'Workout');
});

test('a finished workout goes up once; strength follows the switch; an expired token is renewed', async () => {
  const { h, s } = hub();
  const { connection } = await connect(h);
  const prev = { workouts: [] };
  assert.equal(h.onStateWrite('u1', prev, { ...doc, workouts: [cardio, lifting] }), 2);
  await h._outbox().run();
  assert.equal(s.activities.length, 1, 'the run; the strength session is skipped');
  assert.equal(s.activities[0].sport_type, 'Run');
  // the same document again: nothing new
  assert.equal(h.onStateWrite('u1', { workouts: [cardio, lifting] }, { ...doc, workouts: [cardio, lifting] }), 0);
  h.update('u1', connection.id, { strength: true });
  const third = { ...lifting, id: 'w3' };
  h.onStateWrite('u1', { workouts: [cardio, lifting] }, { ...doc, workouts: [cardio, lifting, third] });
  // the access token is refused once: the refresh is used and the upload goes again
  s.access.clear();
  await h._outbox().run();
  assert.equal(s.activities.length, 2);
  assert.equal(s.activities[1].sport_type, 'WeightTraining');
  assert.ok(s.calls.some(c => c.url === TOKEN_URL && c.form.grant_type === 'refresh_token'));
});

test('a refresh Strava no longer takes asks for a reconnect and pauses, without retrying forever', async () => {
  const { h, s } = hub();
  const { connection } = await connect(h);
  s.access.clear();
  s.refresh.set('r1', false);
  h.onStateWrite('u1', { workouts: [] }, { ...doc, workouts: [cardio] });
  await h._outbox().run();
  const c = h.describe('u1').connections.find(x => x.id === connection.id);
  assert.equal(c.status, 'attention');
  assert.equal(c.paused, true);
  assert.match(c.lastError.msg, /Reconnect Strava/);
  assert.equal(s.activities.length, 0);
  // Disconnect forgets it here and never calls Strava's deauthorize
  const before = s.calls.length;
  h.disconnect('u1', connection.id);
  assert.equal(s.calls.length, before);
  assert.equal(h.describe('u1').connections.length, 0);
});

test('Send test checks the sign-in without posting an activity', async () => {
  const { h, s } = hub();
  const { connection } = await connect(h);
  const r = await h.test('u1', connection.id);
  assert.equal(r.ok, true);
  assert.equal(s.activities.length, 0);
});
