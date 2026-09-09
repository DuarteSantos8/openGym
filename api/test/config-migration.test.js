/* coach.json grew per-provider maps. The file a v1.2.11 instance already has on disk holds one
 * flat credential, one model and one binding; this pins that it is lifted onto the provider it
 * belonged to, once, and that switching providers afterwards never throws a key away. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData } from './helpers.mjs';

const dir = tempData();
const cfg = await import('../coach/config.js');
const FILE = path.join(dir, 'coach.json');

function onDisk(obj) {
  fs.writeFileSync(FILE, JSON.stringify(obj));
  cfg.reset();
  return cfg.load();
}

test('a flat v1.2.11 file is lifted onto its provider', () => {
  const blob = cfg.encrypt({ token: 'tok' });
  const c = onDisk({ enabled: true, provider: 'claude', model: 'claude-x', boundUid: 'alice',
    auth: { type: 'cli-token', account: 'me', data: blob } });
  assert.deepEqual(c.auth, { claude: { type: 'cli-token', account: 'me', data: blob } });
  assert.deepEqual(c.models, { claude: 'claude-x' });
  assert.deepEqual(c.boundUid, { claude: 'alice' });
  assert.equal(c.model, undefined, 'the flat field is gone');
  assert.equal(cfg.authFor(c).type, 'cli-token');
  assert.equal(cfg.modelFor(c), 'claude-x');
  assert.equal(cfg.boundUidFor(c), 'alice');
  assert.equal(cfg.credentialFor('alice').auth.token, 'tok');
});

test('a flat file whose provider was retired keeps nothing from it', () => {
  const c = onDisk({ provider: 'gemini-cli', model: 'x', boundUid: 'alice', auth: { type: 'apikey', data: cfg.encrypt({ token: 't' }) } });
  assert.equal(c.provider, 'fixture');
  assert.deepEqual(c.auth, {});
  assert.deepEqual(c.models, {});
  assert.deepEqual(c.boundUid, {});
});

test('the new shape loads as-is, and unknown or hostile keys in the maps are dropped', () => {
  const c = onDisk({ provider: 'openai',
    auth: { openai: { type: 'apikey', data: 'x' }, 'not-a-provider': { data: 'y' }, __proto__: { data: 'z' } },
    models: { openai: 'gpt-a', gemini: 'g-b', constructor: 'c' },
    providerOptions: { compatible: { baseUrl: 'http://x' } },
    boundUid: 'legacy-string-with-new-maps' });
  assert.deepEqual(Object.keys(c.auth), ['openai']);
  assert.deepEqual(c.models, { openai: 'gpt-a', gemini: 'g-b' });
  assert.deepEqual(c.providerOptions, { compatible: { baseUrl: 'http://x' } });
  assert.deepEqual(c.boundUid, { openai: 'legacy-string-with-new-maps' });
  assert.equal(Object.getPrototypeOf(c.auth), Object.prototype, 'a __proto__ key never became a prototype');
});

test('switching provider keeps every key; each provider has its own model and binding', () => {
  onDisk({ enabled: true, provider: 'anthropic' });
  // A personal credential, so that there is a binding to keep per provider at all — an API
  // key never binds (credential.test.js).
  cfg.saveAuth('anthropic', { type: 'cli-token', data: cfg.encrypt({ token: 'a' }) });
  cfg.saveModel('anthropic', 'claude-a');
  cfg.bindInstanceCredential('alice');
  assert.equal(cfg.boundUidFor(), 'alice');

  cfg.save({ provider: 'openai' });
  assert.equal(cfg.authFor(), null, 'openai has no key yet');
  assert.equal(cfg.modelFor(), 'gpt-5.6', 'openai falls back to its default model');
  assert.equal(cfg.boundUidFor(), null, 'the binding belongs to the anthropic key');
  cfg.saveAuth('openai', { type: 'apikey', data: cfg.encrypt({ token: 'o' }) });

  cfg.save({ provider: 'anthropic' });
  assert.equal(cfg.credentialFor('alice').auth.token, 'a', 'the anthropic key survived the round trip');
  assert.equal(cfg.modelFor(), 'claude-a');
  assert.equal(cfg.boundUidFor(), 'alice');
  assert.equal(cfg.authFor(cfg.load(), 'openai').type, 'apikey');

  // Disconnecting one provider leaves the other alone, and clears only its own binding.
  cfg.saveAuth('openai', null);
  assert.equal(cfg.authFor(cfg.load(), 'openai'), null);
  assert.equal(cfg.credentialFor('alice').ok, true);
});

test('an OpenAI-compatible endpoint with no key is connected once it has a base URL', () => {
  onDisk({ enabled: true, provider: 'compatible' });
  assert.equal(cfg.isConnected(), false, 'no endpoint yet');
  cfg.saveOptions('compatible', { baseUrl: 'http://ollama.lan:11434' });
  assert.equal(cfg.isConnected(), true);
  const c = cfg.credentialFor('anyone');
  assert.equal(c.ok, true);
  assert.equal(c.auth, null);
  assert.equal(cfg.publicConfig().provider, 'compatible');
  // …and a key that was filed but cannot be read is still a failure, not "optional".
  cfg.saveAuth('compatible', { type: 'apikey', data: 'garbage' });
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.credentialFor('anyone').ok, false);
});

test('jobEnv carries only the active provider\'s key under its own variable', () => {
  onDisk({ enabled: true, provider: 'gemini' });
  cfg.saveAuth('gemini', { type: 'apikey', data: cfg.encrypt({ token: 'g' }) });
  cfg.saveAuth('openai', { type: 'apikey', data: cfg.encrypt({ token: 'o' }) });
  const env = cfg.jobEnv('/tmp/x', cfg.credentialFor('alice'));
  assert.equal(env.GEMINI_API_KEY, 'g');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.deepEqual(Object.keys(env).sort(), ['GEMINI_API_KEY', 'HOME', 'PATH', 'TMPDIR']);
});
