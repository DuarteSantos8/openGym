import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';
import { createStrava } from '../strava.js';

const ORIGIN = 'https://gym.example.com';

function fakeStrava() {
  const calls = [];
  let nextId = 100;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    if (url.endsWith('/oauth/token')) {
      if (body.grant_type === 'refresh_token' && body.refresh_token === 'dead') return { ok: false, status: 400, json: async () => ({ message: 'Bad Request' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'acc-' + calls.length, refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 7, firstname: 'Dave', lastname: 'H' } }) };
    }
    return { ok: true, status: 201, json: async () => ({ id: nextId++ }) };
  };
  return { calls, fetchImpl };
}

function harness() {
  const dir = tempData();
  const fake = fakeStrava();
  const strava = createStrava({ dataDir: dir, clientId: '1', clientSecret: 's', origin: ORIGIN, secret: 'k', fetchImpl: fake.fetchImpl });
  const user = { id: 'u1' };
  let session = user;
  const out = {};
  const routes = strava.routes({
    json: (res, code, obj) => { out.code = code; out.body = obj; },
    readBody: async req => req.body || {},
    readSession: () => session,
    readState: () => out.state
  });
  const res = () => ({ writeHead(code, h) { out.code = code; out.location = h.Location; }, end() {} });
  const call = async (key, req = {}) => { await routes[key]({ url: '/', ...req }, res()); return { ...out }; };
  return { strava, fake, call, out, setSession: s => { session = s; } };
}

async function connect(h) {
  const r = await h.call('GET /api/strava/connect');
  const state = new URL(r.location).searchParams.get('state');
  return h.call('GET /api/strava/callback', { url: `/api/strava/callback?code=c&scope=read,activity:write&state=${encodeURIComponent(state)}` });
}

const workout = (id, end, over = {}) => ({
  id, d: '2026-10-08', name: 'Push day', start: end - 50 * 60000, end, prs: [{}],
  entries: [{ id: 'mine', sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] }],
  ...over
});
const settle = () => new Promise(r => setTimeout(r, 20));

test('connect redirects to Strava with write scope and a redirect back to this origin', async () => {
  const h = harness();
  const r = await h.call('GET /api/strava/connect');
  const u = new URL(r.location);
  assert.equal(u.host, 'www.strava.com');
  assert.equal(u.searchParams.get('scope'), 'activity:write');
  assert.equal(u.searchParams.get('redirect_uri'), ORIGIN + '/api/strava/callback');
});

test('a callback whose state was issued to another user is refused', async () => {
  const h = harness();
  const r = await h.call('GET /api/strava/connect');
  const state = new URL(r.location).searchParams.get('state');
  h.setSession({ id: 'someone-else' });
  const back = await h.call('GET /api/strava/callback', { url: `/api/strava/callback?code=c&scope=activity:write&state=${encodeURIComponent(state)}` });
  assert.match(back.location, /strava=error$/);
  assert.equal(h.fake.calls.length, 0, 'no token exchange');
});

test('a callback without the write scope is refused', async () => {
  const h = harness();
  const r = await h.call('GET /api/strava/connect');
  const state = new URL(r.location).searchParams.get('state');
  const back = await h.call('GET /api/strava/callback', { url: `/api/strava/callback?code=c&scope=read&state=${encodeURIComponent(state)}` });
  assert.match(back.location, /strava=scope$/);
});

test('connecting stores the athlete and turns auto-upload on', async () => {
  const h = harness();
  const back = await connect(h);
  assert.match(back.location, /strava=connected$/);
  const s = await h.call('GET /api/strava/status');
  assert.equal(s.body.connected, true);
  assert.equal(s.body.auto, true);
  assert.equal(s.body.athlete.name, 'Dave H');
});

test('a sync uploads only new, recently finished workouts, once', async () => {
  const h = harness();
  await connect(h);
  const S = { unit: 'kg', customEx: [{ id: 'mine', n: 'Bench Press' }], workouts: [
    workout('old', Date.now() - 30 * 86400000),             // before connecting
    workout('new', Date.now()),
    workout('empty', Date.now(), { entries: [{ id: 'mine', sets: [{ w: 1, r: 1, done: false }] }] })
  ] };
  h.strava.onState('u1', S);
  h.strava.onState('u1', S);   // a second sync racing the first
  await settle();
  const posts = h.fake.calls.filter(c => c.url.endsWith('/activities'));
  assert.equal(posts.length, 1);
  const a = posts[0].body;
  assert.equal(a.sport_type, 'WeightTraining');
  assert.equal(a.name, 'Push day');
  assert.equal(a.elapsed_time, 50 * 60);
  assert.match(a.description, /Bench Press: 60kg×10, 60kg×8/);
  assert.match(a.description, /2 sets · 1,080 kg volume · 1 PR/);
  h.strava.onState('u1', S);
  await settle();
  assert.equal(h.fake.calls.filter(c => c.url.endsWith('/activities')).length, 1, 'not uploaded twice');
});

test('auto-upload off means a sync sends nothing; a manual upload still works', async () => {
  const h = harness();
  await connect(h);
  await h.call('POST /api/strava/settings', { body: { auto: false } });
  const S = { workouts: [workout('w1', Date.now())] };
  h.strava.onState('u1', S);
  await settle();
  assert.equal(h.fake.calls.filter(c => c.url.endsWith('/activities')).length, 0);
  h.out.state = S;
  const r = await h.call('POST /api/strava/upload', { body: { id: 'w1' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.activity, 100);
  const again = await h.call('POST /api/strava/upload', { body: { id: 'w1' } });
  assert.equal(again.body.already, true);
});

test('disconnect forgets the tokens without calling Strava', async () => {
  const h = harness();
  await connect(h);
  const before = h.fake.calls.length;
  await h.call('POST /api/strava/disconnect');
  assert.equal(h.fake.calls.length, before, 'no deauthorize call — it would revoke the shared app');
  const s = await h.call('GET /api/strava/status');
  assert.equal(s.body.connected, false);
});

test('side-by-side and timed sets are described', () => {
  const h = harness();
  const a = h.strava.activityFor({ unit: 'lb' }, workout('w', Date.now(), { entries: [
    { id: 'x', sets: [{ sides: { L: { w: 20, r: 10, done: true }, R: { w: 20, r: 9, done: true } } }] },
    { id: 'y', sets: [{ sec: 45, done: true }] }
  ] }));
  assert.match(a.description, /L 20lb×10 \/ R 20lb×9/);
  assert.match(a.description, /: 45s/);
});
