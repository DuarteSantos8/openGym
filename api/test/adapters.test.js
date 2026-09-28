/* The provider adapters, and the four options that make the Claude one safe.
 *
 * These assertions are deliberately about the object the adapter passes to the SDK rather than
 * about observed model behaviour: the point is that re-enabling a tool is a red build, and a
 * test that needed a real account to run would never guard anything in CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { adapterFor, default: ADAPTERS } = await import('../coach/adapters/index.js');
const { LOCKDOWN } = await import('../coach/adapters/claude.js');
const { argvFor } = await import('../coach/adapters/codex.js');
const cfg = await import('../coach/config.js');

test('every provider the config offers has an adapter, and vice versa', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), Object.keys(cfg.PROVIDERS).sort());
  for (const id of Object.keys(cfg.PROVIDERS)) assert.ok(adapterFor(id), `no adapter for "${id}"`);
  assert.equal(adapterFor('not-a-provider'), null);
});

test('the Claude adapter is locked out of every tool the SDK could give it', () => {
  // `tools: []` is the SDK's documented "disable all built-in tools" — no Read, no Bash, no
  // Grep — and the other three stop anything on the host widening that afterwards. If one of
  // these ever has to change, it should be a decision with a diff, not a default that drifted.
  assert.deepEqual(LOCKDOWN.tools, [], 'no built-in tools');
  assert.deepEqual(LOCKDOWN.settingSources, [], 'no settings files may be loaded');
  assert.deepEqual(LOCKDOWN.skills, [], 'no skills may be loaded');
  assert.equal(LOCKDOWN.strictMcpConfig, true, 'no MCP server may arrive from ambient config');
  assert.equal(LOCKDOWN.persistSession, false, 'no session history is written anywhere');
  assert.equal(LOCKDOWN.maxTurns, 1, 'one turn: a job is a question, not a conversation');
});

test('an image built without the AI runtime reports it rather than crashing', async () => {
  // The default build target has no SDK. check() is what the admin card renders, and it has to
  // answer honestly on both targets — this asserts the shape either way, so the test is not
  // hostage to which target the suite happens to run on.
  const r = await adapterFor('claude').check();
  assert.equal(typeof r.ok, 'boolean');
  if (r.ok) assert.match(r.version, /Claude Agent SDK/);
  else assert.match(r.error, /not installed/);
});

test('the fixture provider needs no credential and the Claude one names both it accepts', () => {
  assert.equal(cfg.PROVIDERS.fixture.apiKeyEnv, null);
  assert.equal(cfg.PROVIDERS.fixture.oauthEnv, null);
  // The two variables the runtime reads. jobEnv() injects the credential under one of them and
  // nothing else, which is what makes the sanitised environment the only channel it travels.
  assert.equal(cfg.PROVIDERS.claude.oauthEnv, 'CLAUDE_CODE_OAUTH_TOKEN');
  assert.equal(cfg.PROVIDERS.claude.apiKeyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(cfg.PROVIDERS.claude.setupToken, true);
});

test('the Codex credential cache is a sibling of ./data, never inside it', () => {
  // The documented backup is `tar czf … data/`. A refresh token under ./data would ride along in
  // every archive an owner is told to make, and keep working wherever that archive is copied.
  const home = cfg.CREDENTIAL_HOME;
  assert.ok(home, 'a provider that writes a credential cache needs somewhere to write it');
  assert.equal(home.startsWith(process.env.DATA_DIR + '/'), false, `${home} is inside ./data`);

  // …and it is actually handed to the runtime, under the variable that provider declares.
  cfg.reset();
  cfg.save({ enabled: true, provider: 'codex' });
  assert.equal(cfg.jobEnv('/tmp/job', { ok: true }).CODEX_HOME, home);

  // A provider with no cache of its own is given no such variable at all.
  cfg.reset();
  cfg.save({ enabled: true, provider: 'claude' });
  assert.equal(cfg.jobEnv('/tmp/job', { ok: true }).CODEX_HOME, undefined);
});

test('the Codex adapter runs with the three flags that keep host state out of a job', () => {
  // Same reasoning as the Claude lockdown above: these are not stylistic. --ignore-user-config
  // stops $CODEX_HOME/config.toml being an admin-invisible input to every job, --ephemeral stops
  // session files being written, and --skip-git-repo-check is what lets the bare mkdtemp job dir
  // run at all. Dropping any of them was a green build before this test existed.
  assert.deepEqual(argvFor(null), [
    'exec', '-', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config'
  ]);
});

test('a configured model is appended, and nothing else is', () => {
  assert.deepEqual(argvFor('o4-mini').slice(-2), ['--model', 'o4-mini']);
  assert.equal(argvFor('o4-mini').length, argvFor(null).length + 2);
});

test('every adapter states whether it spawns a process — the privilege gate reads that, not an absence', () => {
  for (const [id, a] of Object.entries(ADAPTERS)) assert.equal(typeof a.spawns, 'boolean', `${id}.spawns`);
  for (const id of ['fixture', 'claude', 'codex']) assert.equal(ADAPTERS[id].spawns, true, id);
  for (const id of ['anthropic', 'openai', 'gemini', 'compatible']) {
    assert.equal(ADAPTERS[id].spawns, false, id);
    assert.equal(cfg.PROVIDERS[id].http, true, id);
    assert.equal(cfg.PROVIDERS[id].credentialHomeEnv, undefined, `${id} keeps no credential cache`);
    assert.equal(typeof ADAPTERS[id].models, 'function', `${id} can list models`);
  }
});
