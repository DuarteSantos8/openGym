/* authMode: profile, through the routes and the real job runner.
 *
 * In profile mode every profile spends its OWN provider account, filed in its own
 * coach-auth-<uid>.json. The properties worth a test are the ones that would be a quiet
 * disaster if they broke: nobody ever receives somebody else's credential, nothing falls back
 * to the instance credential, switching modes throws nothing away, and a pasted token is
 * never echoed back.
 *
 * The only fake is the provider: a local HTTP server that records which key each request
 * carried, reached through the base-URL override. Providers that spawn a runtime (claude) are
 * exercised up to the refusal and the child environment, never as a process, so this file is
 * the same on Windows as on Linux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

/* ---------- a provider on localhost that says which key it was sent ---------- */
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, key: req.headers['x-api-key'] || null });
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) return send(200, { data: [{ id: 'model-a' }] });
    const text = req.url === '/v1/messages' && /ok\\*":true/.test(body) ? '{"coach_contract":1,"ok":true}'
      : JSON.stringify({ coach_contract: 1, nochange: true, reading: 'Nothing to change yet.' });
    if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    send(404, { error: { message: 'unknown route ' + req.url } });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const messageKeys = () => seen.filter(s => s.url === '/v1/messages').map(s => s.key);

/* ---------- the routes, signed in as whoever the call names ---------- */
const USERS = { admin: { id: 'admin', name: 'Admin' }, alice: { id: 'alice', name: 'Alice' }, bob: { id: 'bob', name: 'Bob' }, cleo: { id: 'cleo', name: 'Cleo' } };
const routes = coachRoutes({
  json: (res, code, obj) => { res.status = code; res.body = obj; },
  readBody: async req => req._body || {},
  readSession: req => req._user || null,
  requireAdmin: (req, res) => { if (req._user?.id === 'admin') return req._user; res.status = 403; return null; }
});
const as = (who, route, body) => { const res = {}; return routes[route]({ _body: body, _user: who ? USERS[who] : null }, res).then(() => res); };

async function settle(uid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!jobs.status(uid).job) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

const KEY_A = 'sk-ant-alice-1111', KEY_B = 'sk-ant-bobby-2222', KEY_INSTANCE = 'sk-ant-owner-0000';

/** A clean instance on `provider`. Credential files of earlier tests are removed so each test
 *  starts with nobody connected. */
function fresh(provider, mode, extra = {}) {
  for (const u of Object.keys(USERS)) cfg.clearProfileAuth(u);
  seen.length = 0;
  cfg.reset();
  cfg.save({
    enabled: true, provider, authMode: mode, auth: {}, models: { [provider]: 'model-a' }, boundUid: {}, log: [], daily: null,
    caps: { perProfileDaily: 50, instanceDaily: 0 }, providerOptions: { [provider]: { baseUrl: BASE } }, ...extra
  });
  for (const u of ['alice', 'bob', 'cleo']) { writeState(DIR, u, sampleState()); try { fs.unlinkSync(DIR + '/coach/' + u + '.json'); } catch { /* none yet */ } }
}

/* ---------- 1: A connects, B is refused, B never sees A's token ---------- */

test('profile mode: A connects its own setup token, A gets it, B is refused and can never receive it', async () => {
  fresh('claude', 'profile');
  const tokA = 'sk-ant-oat01-ALICE-secret';

  let r = await as('alice', 'POST /api/coach/credential', { type: 'cli-token', token: tokA, account: 'alice@example.test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // A's job environment carries A's token, under the variable the provider reads.
  const a = cfg.credentialFor('alice');
  assert.equal(a.ok, true);
  assert.equal(cfg.jobEnv('/tmp/j', a).CLAUDE_CODE_OAUTH_TOKEN, tokA);

  // B has connected nothing: refused at the door, with the words that say what to do.
  const b = cfg.credentialFor('bob');
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'no-credential');
  assert.equal(b.auth, undefined);
  assert.match(b.message, /Connect yours in the Coach settings/);
  assert.throws(() => jobs.enqueue('bob', { kind: 'review' }), e => e.code === 'account' && /Coach settings/.test(e.message));
  r = await as('bob', 'POST /api/coach/review', {});
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'account');
  assert.match(r.body.error, /Connect yours in the Coach settings/);

  // However B's environment is built, A's token is not in it, and nothing was spent for B.
  const envB = cfg.jobEnv('/tmp/j', b);
  assert.ok(!JSON.stringify(envB).includes(tokA));
  assert.equal(envB.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(jobs.capState('bob').used, 0);

  // The instance credential is no fallback either: file one, B is still refused.
  cfg.saveAuth('claude', { type: 'cli-token', account: 'owner', data: cfg.encrypt({ token: 'tok-instance' }), connectedAt: 'x' });
  assert.equal(cfg.credentialFor('bob').ok, false);
  assert.ok(!JSON.stringify(cfg.credentialFor('bob')).includes('tok-instance'));
  assert.equal(cfg.credentialFor('alice').auth.token, tokA, 'and A keeps its own, not the instance one');
});

/* ---------- 2: both connect, each job goes out on its own key ---------- */

test('profile mode: A and B each connect a key and each job is sent on its own', async () => {
  fresh('anthropic', 'profile');
  assert.equal((await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A })).status, 200);
  assert.equal((await as('bob', 'POST /api/coach/credential', { type: 'apikey', token: KEY_B })).status, 200);

  assert.equal(cfg.jobEnv('/tmp/j', cfg.credentialFor('alice')).ANTHROPIC_API_KEY, KEY_A);
  assert.equal(cfg.jobEnv('/tmp/j', cfg.credentialFor('bob')).ANTHROPIC_API_KEY, KEY_B);

  jobs.enqueue('alice', { kind: 'review' });
  await settle('alice');
  jobs.enqueue('bob', { kind: 'review' });
  await settle('bob');
  assert.deepEqual(messageKeys(), [KEY_A, KEY_B], 'each request carried the key of the profile that asked');
  assert.equal(jobs.readUser('alice').history.at(-1).outcome, 'nochange');
  assert.equal(jobs.readUser('bob').history.at(-1).outcome, 'nochange');

  // Each credential is its own 0600-class file next to, not inside, the synced state.
  assert.ok(fs.existsSync(cfg.profileAuthFile('alice')) && fs.existsSync(cfg.profileAuthFile('bob')));
  assert.notEqual(cfg.profileAuthFile('alice'), cfg.profileAuthFile('bob'));
  for (const u of ['alice', 'bob']) assert.ok(!fs.readFileSync(`${DIR}/state-${u}.json`, 'utf8').includes('sk-ant-'));
});

test('profile mode: the daily cap still applies per profile', async () => {
  fresh('anthropic', 'profile', { caps: { perProfileDaily: 1, instanceDaily: 0 } });
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A });
  jobs.enqueue('alice', { kind: 'review' });
  await settle('alice');
  assert.throws(() => jobs.enqueue('alice', { kind: 'review' }), e => e.code === 'cap');
});

test('a credential filed for one provider is not sent to another after the admin switches', async () => {
  fresh('anthropic', 'profile');
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A });
  assert.equal(cfg.credentialFor('alice').ok, true);
  cfg.save({ provider: 'openai' });
  assert.equal(cfg.credentialFor('alice').ok, false, 'an Anthropic key must never be handed to an OpenAI endpoint');
  assert.equal(cfg.accountFor('alice').connected, false);
  cfg.save({ provider: 'anthropic' });
  assert.equal(cfg.credentialFor('alice').ok, true, 'and it is still filed when the admin switches back');
});

/* ---------- 3: switching modes deletes nothing ---------- */

test('instance -> profile -> instance keeps the instance credential and its binding intact', async () => {
  fresh('claude', 'instance');
  cfg.saveAuth('claude', { type: 'cli-token', account: 'owner', data: cfg.encrypt({ token: 'tok-owner' }), connectedAt: 'x' });
  cfg.bindInstanceCredential('alice');
  assert.equal(cfg.boundUidFor(), 'alice');
  const filed = JSON.stringify(cfg.load().auth);

  let r = await as('admin', 'POST /api/admin/coach/auth-mode', { mode: 'profile' });
  assert.deepEqual(r.body, { ok: true, authMode: 'profile' });
  assert.equal((await as('admin', 'GET /api/admin/coach')).body.authMode, 'profile');
  assert.equal(cfg.publicConfig().authMode, 'profile');
  // Profile mode ignores the instance credential entirely, even for the profile it was bound to.
  assert.equal(cfg.credentialFor('alice').ok, false);
  assert.equal(cfg.credentialFor('bob').ok, false);
  // A profile that connects in this window keeps its own, and the instance record is untouched.
  await as('bob', 'POST /api/coach/credential', { type: 'cli-token', token: 'tok-bob' });
  assert.equal(JSON.stringify(cfg.load().auth), filed);
  assert.equal(cfg.boundUidFor(), 'alice');

  r = await as('admin', 'POST /api/admin/coach/auth-mode', { mode: 'instance' });
  assert.deepEqual(r.body, { ok: true, authMode: 'instance' });
  assert.equal(JSON.stringify(cfg.load().auth), filed, 'the instance credential was never touched');
  assert.equal(cfg.boundUidFor(), 'alice', 'neither was its binding');
  assert.equal(cfg.credentialFor('alice').auth.token, 'tok-owner');
  assert.equal(cfg.credentialFor('bob').reason, 'shared-account', 'back to refusing the second profile');
  assert.ok(fs.existsSync(cfg.profileAuthFile('bob')), 'bob\'s own credential is still filed for the next switch');

  // Not an admin, or not a mode: nothing moves.
  assert.equal((await as('alice', 'POST /api/admin/coach/auth-mode', { mode: 'profile' })).status, 403);
  assert.equal((await as('admin', 'POST /api/admin/coach/auth-mode', { mode: 'both' })).status, 400);
  assert.equal(cfg.load().authMode, 'instance');
});

/* ---------- 4: the user routes ---------- */

test('the credential routes answer 409 in instance mode and file nothing', async () => {
  fresh('anthropic', 'instance');
  cfg.saveAuth('anthropic', { type: 'apikey', account: '', data: cfg.encrypt({ token: KEY_INSTANCE }), connectedAt: 'x' });
  for (const [route, body] of [
    ['POST /api/coach/credential', { type: 'apikey', token: KEY_A }],
    ['DELETE /api/coach/credential', {}],
    ['POST /api/coach/credential/test', {}]
  ]) {
    const r = await as('alice', route, body);
    assert.equal(r.status, 409, route);
    assert.equal(r.body.code, 'instance-mode');
  }
  assert.ok(!fs.existsSync(cfg.profileAuthFile('alice')));
  assert.equal(seen.length, 0, 'no provider was called');
});

test('a pasted token loses every whitespace character, and no route ever echoes it', async () => {
  fresh('claude', 'profile');
  const wrapped = '  sk-ant-oat01-AAAA\r\nBBBB CCCC\tDDDD\n ';
  const clean = 'sk-ant-oat01-AAAABBBBCCCCDDDD';
  const r = await as('alice', 'POST /api/coach/credential', { type: 'cli-token', token: wrapped, account: 'a@example.test' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(cfg.credentialFor('alice').auth.token, clean);

  const onDisk = fs.readFileSync(cfg.profileAuthFile('alice'), 'utf8');
  assert.ok(!onDisk.includes('AAAA'), 'encrypted at rest');
  assert.equal(JSON.parse(onDisk).account, 'a@example.test');

  for (const [who, route, body] of [
    ['alice', 'GET /api/coach/account'], ['alice', 'GET /api/coach/status'], ['admin', 'GET /api/admin/coach'],
    ['alice', 'POST /api/coach/credential/test'],
    ['bob', 'GET /api/coach/account']
  ]) {
    const res = await as(who, route, body);
    assert.ok(!JSON.stringify(res.body).includes('AAAA'), route + ' must not return the token');
  }

  const acct = (await as('alice', 'GET /api/coach/account')).body;
  assert.equal(acct.mode, 'profile');
  assert.equal(acct.connected, true);
  assert.equal(acct.account, 'a@example.test');
  assert.equal(acct.type, 'cli-token');
  assert.deepEqual(acct.accepts, ['cli-token', 'apikey']);
  const other = (await as('bob', 'GET /api/coach/account')).body;
  assert.equal(other.connected, false);
  assert.equal(other.account, null);
  assert.match(other.message, /Coach settings/);
  assert.equal((await as('admin', 'GET /api/admin/coach')).body.profilesConnected, 1);
});

test('the credential routes validate like the admin connect route and need a session', async () => {
  fresh('openai', 'profile');
  assert.equal((await as(null, 'POST /api/coach/credential', { type: 'cli-token', token: 'x' })).status, 401);
  assert.equal((await as(null, 'DELETE /api/coach/credential')).status, 401);
  assert.equal((await as(null, 'POST /api/coach/credential/test')).status, 401);

  // OpenAI takes an API key, not a setup token; no token at all is no credential.
  let r = await as('alice', 'POST /api/coach/credential', { type: 'cli-token', token: 'x' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /does not take a credential of type "cli-token"/);
  r = await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: ' \n ' });
  assert.equal(r.status, 400);
  assert.equal((await as('alice', 'POST /api/coach/credential', { type: 'nonsense', token: 'x' })).status, 400);
  assert.ok(!fs.existsSync(cfg.profileAuthFile('alice')), 'nothing was filed by a refused request');

  // The provider is the admin's: a body cannot name another one.
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: 'sk-a', provider: 'anthropic' });
  assert.equal(JSON.parse(fs.readFileSync(cfg.profileAuthFile('alice'), 'utf8')).provider, 'openai');
});

test('disconnect removes only the caller\'s own credential', async () => {
  fresh('anthropic', 'profile');
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A });
  await as('bob', 'POST /api/coach/credential', { type: 'apikey', token: KEY_B });
  const r = await as('alice', 'DELETE /api/coach/credential');
  assert.deepEqual(r.body, { ok: true });
  assert.equal(cfg.credentialFor('alice').ok, false);
  assert.equal(cfg.credentialFor('bob').auth.token, KEY_B);
  assert.throws(() => jobs.enqueue('alice', { kind: 'review' }), e => e.code === 'account');
});

/* ---------- 5: "Test my connection" uses the caller's own credential ---------- */

test('the per-user test runs on the caller\'s own key, never another profile\'s, never the instance\'s', async () => {
  fresh('anthropic', 'profile');
  cfg.saveAuth('anthropic', { type: 'apikey', account: '', data: cfg.encrypt({ token: KEY_INSTANCE }), connectedAt: 'x' });
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A });
  await as('bob', 'POST /api/coach/credential', { type: 'apikey', token: KEY_B });
  seen.length = 0;

  let r = await as('bob', 'POST /api/coach/credential/test');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual(messageKeys(), [KEY_B]);
  assert.ok(seen.every(s => s.key === KEY_B), 'the model listing used bob\'s key as well');

  seen.length = 0;
  r = await as('alice', 'POST /api/coach/credential/test');
  assert.equal(r.body.ok, true);
  assert.deepEqual(messageKeys(), [KEY_A]);

  // Cleo has connected nothing: an honest refusal, and the provider is not called at all.
  seen.length = 0;
  r = await as('cleo', 'POST /api/coach/credential/test');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /Coach settings/);
  assert.equal(seen.length, 0);
});

test('the admin test has no credential to run in profile mode and says so, without calling the provider', async () => {
  fresh('anthropic', 'profile');
  cfg.saveAuth('anthropic', { type: 'apikey', account: '', data: cfg.encrypt({ token: KEY_INSTANCE }), connectedAt: 'x' });
  await as('alice', 'POST /api/coach/credential', { type: 'apikey', token: KEY_A });
  seen.length = 0;
  const r = await as('admin', 'POST /api/admin/coach/test');
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /own account/);
  assert.equal(seen.length, 0);
});
