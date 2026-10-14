import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOAuthStore } from '../mcp-oauth-store.js';

test('OAuth artifacts survive restart encrypted and revoke as one grant', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'oauth.json');
  const store = createOAuthStore(file, 'test-secret');
  const grants = new store.Adapter('Grant');
  const tokens = new store.Adapter('AccessToken');
  await grants.upsert('g1', { accountId: 'alice' }, 3600);
  await tokens.upsert('sensitive-access-token', { grantId: 'g1', accountId: 'alice' }, 600);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('alice'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sensitive-access-token'));
  const restarted = createOAuthStore(file, 'test-secret');
  assert.equal((await new restarted.Adapter('AccessToken').find('sensitive-access-token')).accountId, 'alice');
  restarted.revoke('g1');
  assert.equal(await new restarted.Adapter('AccessToken').find('sensitive-access-token'), undefined);
  assert.equal(await new restarted.Adapter('Grant').find('g1'), undefined);
  assert.throws(() => createOAuthStore(file, 'wrong-secret'), /unreadable/);
  fs.writeFileSync(file, '{}');
  assert.throws(() => createOAuthStore(file, 'test-secret'), /unreadable/);
});

test('OAuth adapter rejects expired and account-revoked artifacts and preserves consume state', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-expiry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let active = true;
  const store = createOAuthStore(path.join(directory, 'oauth.json'), 'secret', () => active);
  const adapter = new store.Adapter('AuthorizationCode');
  await adapter.upsert('expired', { accountId: 'alice' }, -1);
  assert.equal(await adapter.find('expired'), undefined);
  store.set('OpenGymGrant', 'g1', { userId: 'alice' });
  await adapter.upsert('code', { grantId: 'g1', uid: 'interaction' }, 600);
  await adapter.consume('code');
  assert.ok((await adapter.find('code')).consumed > 0);
  assert.equal((await adapter.findByUid('interaction')).grantId, 'g1');
  active = false;
  assert.equal(await adapter.find('code'), undefined);
});

test('OAuth storage write failure never acknowledges an unpersisted grant or revocation', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'oauth.json');
  const store = createOAuthStore(file, 'secret');
  store.set('OpenGymGrant', 'g1', { grantId: 'g1', userId: 'alice' });
  // A directory in the atomic writer's temporary-file slot fails on Linux and Windows.
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => store.set('OpenGymGrant', 'g2', { grantId: 'g2', userId: 'bob' }));
  assert.equal(store.get('OpenGymGrant', 'g2'), undefined);
  assert.throws(() => store.revoke('g1'));
  assert.equal(store.get('OpenGymGrant', 'g1').userId, 'alice');
  assert.deepEqual(createOAuthStore(file, 'secret').list('OpenGymGrant'), [store.get('OpenGymGrant', 'g1')]);
});

test('OAuth storage tolerates transient rename locks but bounds retries and fails closed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'oauth.json');
  const store = createOAuthStore(file, 'secret');
  const rename = fs.renameSync;
  let attempts = 0;
  let locked = false;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    attempts++;
    if (locked || attempts <= 2) throw Object.assign(new Error('temporary lock'), { syscall: 'rename', code: 'EPERM' });
    return rename(source, destination);
  });
  store.set('OpenGymGrant', 'g1', { grantId: 'g1', userId: 'alice' });
  assert.equal(attempts, 3);
  assert.equal(createOAuthStore(file, 'secret').get('OpenGymGrant', 'g1').userId, 'alice');
  locked = true;
  attempts = 0;
  assert.throws(() => store.revoke('g1'), { code: 'EPERM' });
  assert.equal(attempts, 5);
  assert.equal(store.get('OpenGymGrant', 'g1').userId, 'alice');
  assert.equal(createOAuthStore(file, 'secret').get('OpenGymGrant', 'g1').userId, 'alice');
});
