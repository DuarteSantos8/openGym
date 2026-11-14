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
  const readConnection = () => JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
  const credential = { token: 'test-access', refresh: 'test-refresh' };
  const rec = { type: 'oauth', account: 'test@example.com', data: cfg.encrypt(credential) };
  const other = { type: 'apikey', data: cfg.encrypt({ token: 'other-test-key' }) };
  const inline = {
    enabled: true, provider: 'chatgpt', auth: { chatgpt: rec, openai: other },
    boundUid: { chatgpt: 'owner' }, models: { chatgpt: 'model' },
    chatgptHost: 'host', chatgptClient: 'client'
  };
  const writeInline = () => fs.writeFileSync(settingsFile, JSON.stringify(inline), { mode: 0o600 });
  return { cfg, data, storage, settingsFile, connectionFile, readSettings, readConnection, credential, rec, other, writeInline };
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
  const { id, ...separated } = s.readConnection();
  assert.match(id, /^[\da-f-]{36}$/);
  const marker = { type: 'external', id };
  assert.deepEqual(s.readSettings().auth, { openai: s.other, chatgpt: marker });
  assert.equal(s.readSettings().boundUid.chatgpt, undefined);
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
  assert.equal(s.readConnection().id, id, 'refresh does not change the connection marker');
  assert.deepEqual(s.readSettings().auth, { openai: s.other, chatgpt: marker });

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

test('restoring a credential saved before binding cannot authorize another profile', async t => {
  const s = await setup(t);
  s.cfg.save({ enabled: true, provider: 'chatgpt' });
  s.cfg.saveAuth('chatgpt', s.rec);
  const unbound = fs.readFileSync(s.connectionFile, 'utf8');
  assert.equal(s.readConnection().boundUid, null);

  s.cfg.bindInstanceCredential('owner');
  s.cfg.reset();
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'shared-account');
  const boundId = s.readConnection().id;
  assert.equal(s.readSettings().auth.chatgpt.id, boundId);

  const refreshed = { ...s.credential, token: 'refreshed-test-access', refresh: 'rotated-test-refresh' };
  s.cfg.save({ auth: { ...s.cfg.load().auth, chatgpt: { ...s.rec, data: s.cfg.encrypt(refreshed) } } });
  s.cfg.reset();
  assert.deepEqual(s.cfg.credentialFor('owner').auth, refreshed);
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'shared-account');
  assert.equal(s.readConnection().id, boundId, 'refresh preserves the bound connection ID');
  assert.equal(s.readSettings().auth.chatgpt.id, boundId);

  // Restore only the old credential, keeping the current settings and encryption key.
  fs.writeFileSync(s.connectionFile, unbound);
  s.cfg.reset();
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'no-credential');
  assert.equal(s.cfg.credentialFor('owner').reason, 'no-credential');
  s.cfg.bindInstanceCredential('another-profile');
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'no-credential');
  assert.equal(s.readConnection().boundUid, null);
  assert.equal(s.readSettings().auth.chatgpt.id, boundId);
  assert.notEqual(boundId, JSON.parse(unbound).id, 'binding invalidates the older snapshot');
});

test('a failed marker write does not activate a binding change', async t => {
  const s = await setup(t);
  s.cfg.save({ enabled: true, provider: 'chatgpt' });
  s.cfg.saveAuth('chatgpt', s.rec);
  const previous = s.readSettings().auth.chatgpt.id;
  fs.mkdirSync(s.settingsFile + '.tmp');

  assert.throws(() => s.cfg.bindInstanceCredential('owner'));
  assert.equal(s.readSettings().auth.chatgpt.id, previous);
  assert.equal(s.readConnection().boundUid, 'owner');
  assert.notEqual(s.readConnection().id, previous);
  assert.equal(s.cfg.credentialFor('owner').reason, 'no-credential');
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'no-credential');
  s.cfg.reset();
  assert.equal(s.cfg.credentialFor('another-profile').reason, 'no-credential');
});

test('an interrupted migration keeps a readable copy and finishes on retry', async t => {
  const s = await setup(t, root => path.join(root, 'private'));
  s.writeInline();
  const before = fs.readFileSync(s.settingsFile, 'utf8');
  fs.writeFileSync(s.storage, 'unavailable directory');
  assert.equal(s.cfg.publicConfig(), null);
  assert.equal(s.cfg.load().provider, 'chatgpt');
  assert.equal(s.cfg.authFor(), null);
  assert.equal(fs.readFileSync(s.settingsFile, 'utf8'), before);
  s.cfg.save({ web: true });
  assert.deepEqual(s.readSettings().auth.chatgpt, s.rec);
  assert.equal(s.readSettings().boundUid.chatgpt, 'owner');
  const saved = fs.readFileSync(s.settingsFile, 'utf8');
  fs.unlinkSync(s.storage);

  fs.mkdirSync(s.settingsFile + '.tmp');
  assert.equal(s.cfg.authFor(), null);
  assert.equal(fs.readFileSync(s.settingsFile, 'utf8'), saved);
  assert.ok(fs.existsSync(s.connectionFile));
  const { id } = s.readConnection();
  fs.rmdirSync(s.settingsFile + '.tmp');
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
  assert.deepEqual(s.readSettings().auth, { openai: s.other, chatgpt: { type: 'external', id } });
  assert.equal(s.readSettings().web, true);
});

test('a legacy disconnect stays disconnected after an older training backup is restored', async t => {
  const s = await setup(t);
  s.writeInline();
  s.cfg.load();
  const backup = s.readSettings();
  const legacy = s.readSettings();
  delete legacy.auth.chatgpt;
  fs.writeFileSync(s.settingsFile, JSON.stringify(legacy));
  fs.mkdirSync(s.connectionFile + '.tmp');
  s.cfg.reset();
  assert.equal(s.cfg.authFor(), null);
  s.cfg.save({ web: true });
  assert.notEqual(s.readConnection().auth, null);
  fs.rmdirSync(s.connectionFile + '.tmp');
  assert.equal(s.cfg.authFor(), null);
  assert.equal(s.readConnection().auth, null);

  fs.writeFileSync(s.settingsFile, JSON.stringify(backup));
  s.cfg.reset();
  assert.equal(s.cfg.authFor(), null);
  s.cfg.saveAuth('chatgpt', s.rec);
  assert.notEqual(s.readConnection().id, backup.auth.chatgpt.id);
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
});

test('a different inline connection after rollback requires a fresh sign-in', async t => {
  const s = await setup(t);
  s.writeInline();
  s.cfg.load();
  const legacy = s.readSettings();
  legacy.auth.chatgpt = { ...s.rec, data: s.cfg.encrypt({ token: 'other-test-access' }) };
  fs.writeFileSync(s.settingsFile, JSON.stringify(legacy));
  s.cfg.reset();
  assert.equal(s.cfg.authFor(), null);
  assert.equal(s.readConnection().auth, null);
  assert.deepEqual(s.readSettings().auth, { openai: s.other });
});

test('an unrelated save preserves the marker while the ChatGPT preview is off', async t => {
  const s = await setup(t);
  s.writeInline();
  s.cfg.load();
  const before = s.readSettings().auth;
  process.env.COACH_CHATGPT_PLAN = 'off';
  const disabled = await import('../coach/config.js?off=' + encodeURIComponent(s.data));
  assert.equal(disabled.authFor(disabled.load(), 'chatgpt'), null);
  disabled.save({ web: true });
  assert.deepEqual(s.readSettings().auth, before);
  s.cfg.reset();
  s.cfg.save({ provider: 'chatgpt' });
  assert.deepEqual(s.cfg.credentialFor('owner').auth, s.credential);
});

test('a failed marker write does not activate a replacement connection', async t => {
  const s = await setup(t);
  s.writeInline();
  s.cfg.load();
  const previous = s.readSettings().auth.chatgpt.id;
  const replacement = { ...s.rec, data: s.cfg.encrypt({ token: 'replacement-test-access' }) };
  fs.mkdirSync(s.settingsFile + '.tmp');
  assert.throws(() => s.cfg.saveAuth('chatgpt', replacement));
  assert.equal(s.readSettings().auth.chatgpt.id, previous);
  assert.equal(s.cfg.authFor(), null);
  fs.rmdirSync(s.settingsFile + '.tmp');
  s.cfg.saveAuth('chatgpt', replacement);
  s.cfg.reset();
  assert.equal(s.cfg.authFor().data, replacement.data);
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
