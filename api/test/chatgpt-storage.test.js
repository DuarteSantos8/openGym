import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function setup(t, credentialRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-chatgpt-storage-'));
  const data = path.join(root, 'data');
  const storage = credentialRoot ? credentialRoot(root, data) : data + '-coach-auth';
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'secret'), 'a'.repeat(64), { mode: 0o600 });
  const old = {
    DATA_DIR: process.env.DATA_DIR,
    COACH_CHATGPT_PLAN: process.env.COACH_CHATGPT_PLAN,
    COACH_CHATGPT_CREDENTIAL_DIR: process.env.COACH_CHATGPT_CREDENTIAL_DIR
  };
  process.env.DATA_DIR = data;
  process.env.COACH_CHATGPT_PLAN = 'on';
  if (credentialRoot) process.env.COACH_CHATGPT_CREDENTIAL_DIR = storage;
  else delete process.env.COACH_CHATGPT_CREDENTIAL_DIR;
  t.after(() => {
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const cfg = await import('../coach/config.js?' + encodeURIComponent(root));
  const settingsFile = path.join(data, 'coach.json');
  const connectionFile = path.join(storage, 'chatgpt', 'connection.json');
  const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const credential = { token: 'test-access', refresh: 'test-refresh' };
  const rec = { type: 'oauth', account: 'test@example.com', data: cfg.encrypt(credential) };
  const other = { type: 'apikey', data: cfg.encrypt({ token: 'other-test-key' }) };
  const inline = {
    enabled: true, provider: 'chatgpt', auth: { chatgpt: rec, openai: other },
    boundUid: { chatgpt: 'owner' }, models: { chatgpt: 'model' },
    chatgptHost: 'host', chatgptClient: 'client'
  };
  const writeInline = () => fs.writeFileSync(settingsFile, JSON.stringify(inline), { mode: 0o600 });
  return { cfg, data, storage, settingsFile, connectionFile, readSettings, credential, rec, other, writeInline };
}

test('migrates the subscription and keeps it out of future training backups', async t => {
  const s = await setup(t);
  s.writeInline();
  const live = s.cfg.load();
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'shared-account');
  assert.equal(live.chatgptClient, 'client');
  assert.equal(live.chatgptHost, 'host');
  assert.equal(s.cfg.modelFor(live), 'model');
  assert.deepEqual(s.readSettings().auth, { openai: s.other });
  assert.equal(s.readSettings().boundUid.chatgpt, undefined);
  const separated = JSON.parse(fs.readFileSync(s.connectionFile, 'utf8'));
  assert.deepEqual(separated, { auth: s.rec, boundUid: 'owner' });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(s.connectionFile)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(s.connectionFile).mode & 0o777, 0o600);
  }

  const refreshed = { ...s.credential, refresh: 'rotated-test-refresh' };
  s.cfg.save({ auth: { ...live.auth, chatgpt: { ...s.rec, data: s.cfg.encrypt(refreshed) } } });
  s.cfg.reset();
  assert.deepEqual(s.cfg.credentialFor('owner').auth, refreshed);
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'shared-account');
  s.cfg.saveOptions('openai', { baseUrl: 'https://example.com' });
  assert.deepEqual(s.readSettings().auth, { openai: s.other });

  const backup = path.join(path.dirname(s.data), 'training-backup');
  fs.cpSync(s.data, backup, { recursive: true });
  process.env.DATA_DIR = backup;
  const restored = await import('../coach/config.js?' + encodeURIComponent(backup));
  process.env.DATA_DIR = s.data;
  assert.equal(restored.credentialFor('owner').reason, 'no-credential');

  s.cfg.saveAuth('chatgpt', null);
  s.writeInline();
  s.cfg.reset();
  assert.equal(s.cfg.authFor(), null, 'restoring an old inline copy does not reconnect a removed account');
  assert.deepEqual(s.readSettings().auth, { openai: s.other });
});

test('an interrupted migration keeps a readable copy and finishes on retry', async t => {
  const s = await setup(t, root => path.join(root, 'private'));
  s.writeInline();
  const before = fs.readFileSync(s.settingsFile, 'utf8');
  fs.writeFileSync(s.storage, 'unavailable directory');
  assert.throws(() => s.cfg.load());
  assert.equal(fs.readFileSync(s.settingsFile, 'utf8'), before);
  fs.unlinkSync(s.storage);

  fs.mkdirSync(s.settingsFile + '.tmp');
  assert.throws(() => s.cfg.load());
  assert.equal(fs.readFileSync(s.settingsFile, 'utf8'), before);
  assert.ok(fs.existsSync(s.connectionFile));
  fs.rmdirSync(s.settingsFile + '.tmp');
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
  assert.deepEqual(s.readSettings().auth, { openai: s.other });
});

test('a credential directory inside DATA_DIR cannot accept a connection', async t => {
  const s = await setup(t, (_root, data) => path.join(data, 'nested'));
  assert.throws(() => s.cfg.saveAuth('chatgpt', s.rec), /outside DATA_DIR/);
  assert.equal(s.cfg.authFor(s.cfg.load(), 'chatgpt'), null);
  assert.equal(fs.existsSync(s.connectionFile), false);
});

test('explicit disconnect replaces an unreadable credential and reports write failures', async t => {
  const s = await setup(t);
  s.cfg.saveAuth('chatgpt', s.rec);
  const unreadable = 'incomplete connection record';
  fs.writeFileSync(s.connectionFile, unreadable);
  s.cfg.reset();
  assert.equal(s.cfg.authFor(s.cfg.load(), 'chatgpt'), null);

  fs.mkdirSync(s.connectionFile + '.tmp');
  assert.throws(() => s.cfg.saveAuth('chatgpt', null));
  assert.equal(fs.readFileSync(s.connectionFile, 'utf8'), unreadable);
  fs.rmdirSync(s.connectionFile + '.tmp');

  s.cfg.saveAuth('chatgpt', null);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.connectionFile, 'utf8')), { auth: null, boundUid: null });
  s.cfg.reset();
  assert.equal(s.cfg.authFor(s.cfg.load(), 'chatgpt'), null);
});
