import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { tempData } from './helpers.mjs';

tempData();
process.env.COACH_CHATGPT_PLAN = 'on';
const plan = await import('../coach/chatgpt-plan.js');
const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');
const { chatGptLoopbackOn, listenForChatGptCallback } = await import('../coach/chatgpt-loopback.js');
const browserFetch = globalThis.fetch;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }];
const clientId = 'oaiapp_test';
const authCode = 'test-code';

test('the optional loopback listener requires the ChatGPT plan preview', () => {
  assert.equal(chatGptLoopbackOn({ COACH_CHATGPT_LOOPBACK: 'on' }), false);
  assert.equal(chatGptLoopbackOn({ COACH_CHATGPT_PLAN: 'on' }), false);
  assert.equal(chatGptLoopbackOn({ COACH_CHATGPT_LOOPBACK: 'on', COACH_CHATGPT_PLAN: 'on' }), true);
});

function signIn(port = 0) {
  cfg.save({ auth: {}, boundUid: {}, chatgptClient: null });
  let listenerPort;
  const routes = coachRoutes({
    json: (res, status, body) => Object.assign(res, { status, body }),
    readBody: async req => req.body,
    requireAdmin: req => req.admin,
    listenChatGpt: capture => {
      const listener = listenForChatGptCallback(capture, port);
      listener.ready.then(bound => { listenerPort = bound; });
      return listener;
    }
  });
  const call = async (route, body = {}, id = 'admin') => {
    const res = {};
    await routes[`POST /api/admin/coach/chatgpt/${route}`]({ body, admin: { id } }, res);
    return res;
  };
  return { call, port: () => listenerPort };
}

function callbackFor(start, listenerPort) {
  const authorize = new URL(start.body.url);
  const url = new URL(authorize.searchParams.get('redirect_uri'));
  if (listenerPort) url.port = String(listenerPort);
  url.search = new URLSearchParams({ state: authorize.searchParams.get('state'), code: authCode, client_id: clientId });
  return url;
}

function mockOpenAI(t, start, beforeExchange = async () => {}) {
  const authorize = new URL(start.body.url).searchParams;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: plan.ISSUER, aud: clientId, exp: Math.floor(Date.now() / 1000) + 600,
    nonce: authorize.get('nonce'), sub: 'test-user', email: 'admin@example.test'
  })).toString('base64url');
  const signed = header + '.' + payload;
  const idToken = signed + '.' + crypto.sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url');
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === plan.JWKS_URL) return Response.json({ keys });
    assert.equal(url, plan.TOKEN_URL);
    const fields = new URLSearchParams(init.body);
    assert.equal(fields.get('code'), authCode);
    assert.equal(fields.get('redirect_uri'), plan.REDIRECT_URI);
    const challenge = crypto.createHash('sha256').update(fields.get('code_verifier')).digest('base64url');
    assert.equal(challenge, authorize.get('code_challenge'));
    await beforeExchange();
    return Response.json({ access_token: 'test-access', id_token: idToken, scope: plan.SCOPE });
  });
}

test('the loopback callback finishes once from the initiating admin card', { timeout: 10000 }, async t => {
  process.env.COACH_CHATGPT_LOOPBACK = 'on';
  const { call, port } = signIn();
  const start = await call('start');
  assert.equal(start.status, 200);
  assert.equal(start.body.automatic, true);
  assert.ok(start.body.expiresInMs > 0 && start.body.expiresInMs <= plan.PENDING_TTL_MS);
  const id = { attemptId: start.body.attemptId };
  const received = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const fetchAuth = mockOpenAI(t, start, () => { received.resolve(); return release.promise; });

  assert.equal((await call('start', {}, 'other-admin')).status, 409);
  assert.deepEqual(await call('finish', id), { status: 202, body: { pending: true } });
  const callback = await browserFetch(callbackFor(start, port()));
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get('cache-control'), 'no-store');
  assert.equal(await callback.text(), 'Return to openGym to finish signing in.');
  assert.equal(fetchAuth.mock.callCount(), 0, 'the browser callback does not exchange tokens');
  assert.equal((await call('finish', id, 'other-admin')).status, 400);

  const finish = call('finish', id);
  await received.promise;
  assert.equal((await call('finish', id)).status, 202);
  release.resolve();
  const done = await finish;
  assert.deepEqual(done, { status: 200, body: { ok: true, account: 'admin@example.test', usage: plan.USAGE_URL } });
  assert.deepEqual(await call('finish', id), done);
  assert.equal(fetchAuth.mock.calls.filter(c => c.arguments[0] === plan.TOKEN_URL).length, 1);
  assert.equal(cfg.authFor(cfg.load(), 'chatgpt').type, 'oauth');
  await assert.rejects(browserFetch(callbackFor(start, port())), 'the listener closes after the callback');
});

test('the pasted callback still works when the loopback port is occupied', async t => {
  process.env.COACH_CHATGPT_LOOPBACK = 'on';
  const blocker = http.createServer();
  await new Promise((resolve, reject) => blocker.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const { call } = signIn(blocker.address().port);
  const start = await call('start');
  assert.equal(start.status, 200);
  assert.equal(start.body.automatic, false);
  const callback = callbackFor(start).href;
  mockOpenAI(t, start);
  assert.equal((await call('finish', { callback }, 'other-admin')).status, 400);
  const incomplete = new URL(callback);
  incomplete.searchParams.delete('code');
  assert.deepEqual(await call('finish', { callback: incomplete.href }), { status: 400, body: { error: 'no code in that address' } });
  assert.equal((await call('finish', { callback })).status, 200, 'older admin cards can still paste the callback');
});

test('a failed token exchange tells the card that the attempt has ended', async t => {
  process.env.COACH_CHATGPT_LOOPBACK = 'off';
  const { call } = signIn();
  const start = await call('start');
  const callback = callbackFor(start).href;
  const transport = mockOpenAI(t, start, () => { throw new Error('provider unavailable'); });
  const id = { attemptId: start.body.attemptId };
  assert.deepEqual(await call('finish', { ...id, callback }), {
    status: 502, body: { error: 'ChatGPT could not complete the token exchange; start sign-in again', code: 'chatgpt-sign-in-ended' }
  });
  assert.equal((await call('finish', id)).body.code, 'chatgpt-sign-in-ended');
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(cfg.authFor(cfg.load(), 'chatgpt'), null);
});

test('a native API on the callback port uses the pasted sign-in', async t => {
  process.env.COACH_CHATGPT_LOOPBACK = 'on';
  const port = process.env.PORT;
  process.env.PORT = new URL(plan.REDIRECT_URI).port;
  t.after(() => {
    if (port === undefined) delete process.env.PORT;
    else process.env.PORT = port;
  });
  const { call, port: listenerPort } = signIn();
  const start = await call('start');
  assert.equal(start.body.automatic, false);
  assert.equal(listenerPort(), undefined);
  mockOpenAI(t, start);
  assert.equal((await call('finish', { callback: callbackFor(start).href })).status, 200);
});

test('failed or abandoned ChatGPT sign-in closes its loopback listener', async t => {
  process.env.COACH_CHATGPT_LOOPBACK = 'on';
  const { call, port } = signIn();
  for (const [error, message] of [
    ['access_denied', 'ChatGPT plan use was not allowed'],
    ['server_error', 'ChatGPT could not complete sign-in']
  ]) {
    const failed = await call('start');
    assert.equal(failed.body.automatic, true);
    const callback = callbackFor(failed, port());
    callback.searchParams.delete('code');
    callback.searchParams.set('error', error);
    assert.equal((await browserFetch(callback)).status, 200);
    assert.deepEqual(await call('finish', { attemptId: failed.body.attemptId }), {
      status: 400, body: { error: message, code: 'chatgpt-sign-in-ended' }
    });
    await assert.rejects(browserFetch(callback));
  }

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const abandoned = await call('start');
  assert.equal(abandoned.body.automatic, true);
  t.mock.timers.tick(plan.PENDING_TTL_MS);
  t.mock.timers.reset();
  assert.equal((await call('finish', { attemptId: abandoned.body.attemptId })).status, 400);
  await assert.rejects(browserFetch(callbackFor(abandoned, port())));
});
