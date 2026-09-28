/* Whose account pays for a job, and what happens when the answer is "somebody else's".
 *
 * The refusal in instance mode is the point of this file. An instance-level credential is one
 * person's account; the moment a second profile would spend it, the safe answer is no job at
 * all. Warning-and-continuing would put the decision on whoever clicks past the warning, and
 * the decision is about somebody's personal subscription.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData } from './helpers.mjs';

const dir = tempData();
const cfg = await import('../coach/config.js');

function connectInstance(token = 'tok-instance') {
  cfg.reset();
  cfg.save({
    enabled: true, provider: 'claude', authMode: 'instance', boundUid: {},
    auth: { claude: { type: 'cli-token', account: 'owner@example.test', data: cfg.encrypt({ token }) } }
  });
}

test('instance mode: the first profile to spend the credential binds it', () => {
  connectInstance();
  const first = cfg.credentialFor('alice');
  assert.equal(first.ok, true);
  assert.equal(first.auth.token, 'tok-instance');
  assert.equal(cfg.boundUidFor(), null, 'resolving alone must not bind — only spending does');

  cfg.bindInstanceCredential('alice');
  assert.equal(cfg.boundUidFor(), 'alice');
});

test('instance mode: an API key binds to nobody — every profile shares it', () => {
  cfg.reset();
  cfg.save({
    enabled: true, provider: 'anthropic', authMode: 'instance', boundUid: {},
    auth: { anthropic: { type: 'apikey', account: '', data: cfg.encrypt({ token: 'sk-ant-shared' }) } }
  });
  cfg.bindInstanceCredential('alice');
  assert.equal(cfg.boundUidFor(), null, 'a metered key is issued for exactly this use; binding it would just look broken');
  assert.equal(cfg.credentialFor('bob').ok, true);
  assert.equal(cfg.credentialFor('bob').auth.token, 'sk-ant-shared');
  assert.equal(cfg.isPersonalCredential('apikey'), false);
  assert.equal(cfg.isPersonalCredential('cli-token'), true);
});

test('instance mode: a second profile is refused, not warned', () => {
  connectInstance();
  cfg.bindInstanceCredential('alice');

  const second = cfg.credentialFor('bob');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'shared-account');
  assert.equal(second.message, cfg.SHARED_ACCOUNT_REFUSAL);
  assert.equal(second.auth, undefined, 'a refused profile is never handed the token');
});

test('instance mode: the bound profile keeps working', () => {
  connectInstance();
  cfg.bindInstanceCredential('alice');
  assert.equal(cfg.credentialFor('alice').ok, true);
});

test('per-profile mode: each profile answers for itself', () => {
  cfg.reset();
  cfg.save({ enabled: true, provider: 'claude', authMode: 'profile', auth: null, boundUid: null });

  assert.equal(cfg.credentialFor('alice').ok, false, 'nobody is signed in yet');
  assert.equal(cfg.credentialFor('alice').reason, 'no-credential');

  cfg.saveProfileAuth('alice', { type: 'cli-token', account: 'alice@example.test', data: cfg.encrypt({ token: 'tok-alice' }) });

  const a = cfg.credentialFor('alice');
  assert.equal(a.ok, true);
  assert.equal(a.auth.token, 'tok-alice');
  assert.equal(a.account, 'alice@example.test');

  // Bob signing in later must not reach Alice's token, and vice versa.
  assert.equal(cfg.credentialFor('bob').ok, false);
  cfg.saveProfileAuth('bob', { type: 'cli-token', account: 'bob@example.test', data: cfg.encrypt({ token: 'tok-bob' }) });
  assert.equal(cfg.credentialFor('bob').auth.token, 'tok-bob');
  assert.equal(cfg.credentialFor('alice').auth.token, 'tok-alice');
});

test('per-profile mode never refuses for sharing — that is what it is for', () => {
  cfg.reset();
  cfg.save({ enabled: true, provider: 'claude', authMode: 'profile', boundUid: 'alice' });
  cfg.saveProfileAuth('bob', { type: 'cli-token', data: cfg.encrypt({ token: 'tok-bob' }) });
  const b = cfg.credentialFor('bob');
  assert.equal(b.ok, true, 'a stale boundUid from a previous instance-mode config must not leak in');
});

test('a profile credential lives in its own file, not in synced state', () => {
  cfg.reset();
  cfg.saveProfileAuth('alice', { type: 'cli-token', data: cfg.encrypt({ token: 'tok-alice' }) });
  const file = cfg.profileAuthFile('alice');
  assert.match(file, /coach-auth-alice\.json$/);
  assert.ok(!file.includes('state-'), 'must not ride along in the state blob the client syncs');

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('a profile id cannot escape the data directory', () => {
  assert.throws(() => cfg.profileAuthFile('../../etc/passwd'), /bad profile id/);
  assert.throws(() => cfg.profileAuthFile('a/b'), /bad profile id/);
  assert.throws(() => cfg.profileAuthFile(''), /bad profile id/);
});

test('clearing a profile credential removes it', () => {
  cfg.reset();
  cfg.saveProfileAuth('alice', { type: 'cli-token', data: cfg.encrypt({ token: 't' }) });
  assert.equal(cfg.credentialFor.length >= 1, true);
  cfg.clearProfileAuth('alice');
  cfg.save({ enabled: true, provider: 'claude', authMode: 'profile' });
  assert.equal(cfg.credentialFor('alice').ok, false);
});

test('the fixture needs no account at all', () => {
  cfg.reset();
  cfg.save({ enabled: true, provider: 'fixture', authMode: 'instance', auth: null, boundUid: 'someone-else' });
  const c = cfg.credentialFor('anybody');
  assert.equal(c.ok, true, 'the fixture is how an instance is exercised without an AI account');
});

test('accountFor names the account without revealing the token', () => {
  connectInstance('secret-token-value');
  const a = cfg.accountFor('alice');
  assert.equal(a.connected, true);
  assert.equal(a.account, 'owner@example.test');
  assert.equal(a.mode, 'instance');
  assert.equal(JSON.stringify(a).includes('secret-token-value'), false);
});

test('accountFor carries the refusal so the screen can state it', () => {
  connectInstance();
  cfg.bindInstanceCredential('alice');
  const b = cfg.accountFor('bob');
  assert.equal(b.connected, false);
  assert.equal(b.reason, 'shared-account');
  assert.equal(b.message, cfg.SHARED_ACCOUNT_REFUSAL);
});

test('jobEnv only ever carries the credential it was handed', () => {
  connectInstance('tok-for-env');
  const resolved = cfg.credentialFor('alice');
  const env = cfg.jobEnv('/tmp/job', resolved);
  assert.equal(env.HOME, '/tmp/job');
  assert.equal(env.TMPDIR, '/tmp/job');
  // Built from nothing: no RP_ID, no ADMIN_UIDS, no VAPID material, nothing this server holds.
  // The one permitted addition is the configured provider's own credential variable — read off
  // the row rather than hardcoded, so this keeps testing the contract if that name ever changes.
  // connectInstance() files a `cli-token`, which jobEnv injects under the provider's oauthEnv.
  const expected = [cfg.providerMeta(cfg.load()).oauthEnv].filter(Boolean);
  assert.deepEqual(
    Object.keys(env).filter(k => !['PATH', 'HOME', 'TMPDIR'].includes(k)).sort(),
    expected,
    'only the credential the job was handed may appear, under its provider\'s own variable'
  );
  if (expected.length) assert.equal(env[expected[0]], 'tok-for-env');

  const none = cfg.jobEnv('/tmp/job', { ok: false });
  assert.equal(Object.values(none).some(v => String(v).includes('tok-for-env')), false);
});
