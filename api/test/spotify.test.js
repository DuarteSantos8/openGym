/* Spotify on the account (api/music/spotify.js): the sign-in this server starts and finishes, the
   tokens kept sealed on the user row and refreshed, and what Spotify's refusals turn into. Spotify
   itself is a stand-in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyConfig, createSpotify, trackOf } from '../music/spotify.js';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cfg = spotifyConfig({ SPOTIFY_CLIENT_ID: 'abcdefabcdefabcdef12' }, 'https://gym.example.com/');

function setup(answers, clock = { t: 1e12 }) {
  const calls = [];
  let saved = 0;
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (!a) throw new Error('unexpected call ' + url);
    return typeof a === 'function' ? a(url, init) : a;
  };
  const sp = createSpotify(cfg, {
    seal: o => 'sealed:' + JSON.stringify(o), unseal: b => JSON.parse(String(b).slice(7)),
    save: () => { saved++; }, fetchFn, now: () => clock.t
  });
  return { sp, calls, clock, saved: () => saved };
}

async function connect(env, user) {
  const url = new URL(env.sp.start(user, { app: true }));
  return env.sp.finish(new URLSearchParams({ code: 'C', state: url.searchParams.get('state') }), id => (id === user.id ? user : null));
}

test('config: only a real Client ID turns it on, and the redirect is the instance\'s own', () => {
  assert.equal(spotifyConfig({}, 'https://x'), null);
  assert.equal(spotifyConfig({ SPOTIFY_CLIENT_ID: 'not one!' }, 'https://x'), null);
  assert.equal(cfg.redirectUri, 'https://gym.example.com/api/music/spotify/callback');
  assert.equal(spotifyConfig({ SPOTIFY_CLIENT_ID: 'abcdefabcdefabcdef12', SPOTIFY_REDIRECT_URI: 'https://a/b' }, 'https://x').redirectUri, 'https://a/b');
});

test('the sign-in uses PKCE, and its way back saves the tokens sealed with the account name', async () => {
  const env = setup([res(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 }), res(200, { display_name: 'Ana' })]);
  const user = { id: 'u1' };
  const url = new URL(env.sp.start(user, { app: true }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), cfg.redirectUri);
  const r = await env.sp.finish(new URLSearchParams({ code: 'C', state: url.searchParams.get('state') }), () => user);
  assert.deepEqual(r, { ok: true, app: true, back: null });
  const body = new URLSearchParams(env.calls[0].init.body);
  assert.equal(body.get('code_verifier').length >= 43, true);
  assert.equal(body.get('client_id'), cfg.clientId);
  assert.match(user.spotify.tokens, /^sealed:/);
  assert.equal(user.spotify.name, 'Ana');
  assert.deepEqual(env.sp.status(user), { available: true, connected: true, name: 'Ana', redirect: cfg.redirectUri });
  // A state is good for one way back only.
  assert.equal(await env.sp.finish(new URLSearchParams({ code: 'C', state: url.searchParams.get('state') }), () => user), null);
});

test('a state this server never handed out, or one that expired, is not an answer', async () => {
  const env = setup([]);
  const user = { id: 'u1' };
  assert.equal(await env.sp.finish(new URLSearchParams({ code: 'C', state: 'nope' }), () => user), null);
  const url = new URL(env.sp.start(user));
  env.clock.t += 11 * 60000;
  assert.equal(await env.sp.finish(new URLSearchParams({ code: 'C', state: url.searchParams.get('state') }), () => user), null);
});

test('a refusal on Spotify\'s page comes back as not connected, without a token request', async () => {
  const env = setup([]);
  const user = { id: 'u1' };
  const url = new URL(env.sp.start(user, { back: 'https://gym.example.com/' }));
  const r = await env.sp.finish(new URLSearchParams({ error: 'access_denied', state: url.searchParams.get('state') }), () => user);
  assert.deepEqual(r, { ok: false, app: false, back: 'https://gym.example.com/' });
  assert.equal(env.calls.length, 0);
  assert.equal(user.spotify, undefined);
});

test('what plays: refreshed when the token is old, keeping the refresh token, and shared for a moment', async () => {
  const env = setup([
    res(200, { access_token: 'A', refresh_token: 'R', expires_in: 0 }), res(200, {}),
    res(200, { access_token: 'B', expires_in: 3600 }),
    res(200, { is_playing: true, item: { id: 't', name: 'Song', artists: [{ name: 'X' }], album: { images: [{ url: 'https://i/1', width: 300 }, { url: 'https://i/2', width: 64 }] } } })
  ]);
  const user = { id: 'u1' };
  await connect(env, user);
  const t = await env.sp.nowPlaying(user);
  assert.deepEqual(t, { id: 't', playing: true, title: 'Song', artist: 'X', art: 'https://i/2' });
  assert.equal(new URLSearchParams(env.calls[2].init.body).get('refresh_token'), 'R');
  assert.equal(env.calls[3].init.headers.Authorization, 'Bearer B');
  assert.equal(JSON.parse(user.spotify.tokens.slice(7)).refresh, 'R');
  // A second device asking straight after gets the same answer, without a call to Spotify.
  assert.deepEqual(await env.sp.nowPlaying(user), t);
  assert.equal(env.calls.length, 4);
});

test('nothing playing is null; controls name Premium and no device', async () => {
  const env = setup([
    res(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 }), res(200, {}),
    res(204), res(403, {}), res(404, {})
  ]);
  const user = { id: 'u1' };
  await connect(env, user);
  assert.equal(await env.sp.nowPlaying(user), null);
  await assert.rejects(env.sp.control(user, 'next'), { code: 'premium' });
  await assert.rejects(env.sp.control(user, 'play'), { code: 'device' });
  assert.equal(env.calls[3].url, 'https://api.spotify.com/v1/me/player/next');
  assert.equal(env.calls[3].init.method, 'POST');
  assert.equal(env.calls[4].init.method, 'PUT');
});

test('two requests with an old token share one refresh, so a replaced refresh token cannot disconnect', async () => {
  const env = setup([
    res(200, { access_token: 'A', refresh_token: 'R', expires_in: 0 }), res(200, {}),
    res(200, { access_token: 'B', refresh_token: 'R2', expires_in: 3600 }),
    res(204), res(204)
  ]);
  const user = { id: 'u1' };
  await connect(env, user);
  await Promise.all([env.sp.nowPlaying(user), env.sp.control(user, 'next')]);
  const refreshes = env.calls.filter(c => new URLSearchParams(c.init.body || '').get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.ok(user.spotify.tokens);
  assert.equal(JSON.parse(user.spotify.tokens.slice(7)).refresh, 'R2');
});

test('a refresh token Spotify no longer honours disconnects the profile', async () => {
  const env = setup([res(200, { access_token: 'A', refresh_token: 'R', expires_in: 0 }), res(200, {}), res(400, { error: 'invalid_grant' })]);
  const user = { id: 'u1' };
  await connect(env, user);
  await assert.rejects(env.sp.nowPlaying(user), { code: 'auth' });
  assert.equal(user.spotify, undefined);
  await assert.rejects(env.sp.nowPlaying(user), { code: 'auth' });
});

test('only an https cover is passed on', () => {
  assert.equal(trackOf({ item: { name: 'x', album: { images: [{ url: 'http://i', width: 64 }] } } }).art, '');
});
