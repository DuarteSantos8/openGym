import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createMcpConfiguration, validateMcpConfiguration } from '../mcp-config.js';

const origin = 'https://gym.example';
const settings = { enabled: true, url: origin + '/gym/mcp', clients: [
  { client_id: 'chatgpt', client_name: 'ChatGPT', redirect_uris: ['https://client.example/callback'] }
] };

test('MCP GUI settings persist but become effective only after API restart', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-settings-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const config = createMcpConfiguration({ data, origin, env: {} });
  assert.equal(config.effective.enabled, false);
  config.save(settings);
  assert.equal(config.status(true).enabled, false);
  assert.equal(config.status(true).restartRequired, true);
  assert.deepEqual(config.status(true).saved, settings);
  assert.equal(config.status(false).saved, undefined);
  assert.equal(config.status(false).restartRequired, undefined);
  const restarted = createMcpConfiguration({ data, origin, env: { MCP_ENABLED: '0' } });
  assert.deepEqual(restarted.effective, settings);
  assert.equal(restarted.status(true).restartRequired, false);
  assert.deepEqual(restarted.status(false).clients, [{ client_id: 'chatgpt', client_name: 'ChatGPT' }]);
  assert.equal(restarted.status(false).clients[0].redirect_uris, undefined);
  config.save({ ...settings, enabled: false });
  assert.equal(createMcpConfiguration({ data, origin, env: {} }).effective.enabled, false);
});

test('MCP configuration rejects unsafe endpoints and callbacks without overwriting saved settings', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-invalid-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const config = createMcpConfiguration({ data, origin, env: {} });
  const client = settings.clients[0];
  for (const value of [{ ...settings, enabled: 'true' }, { ...settings, url: 'https://evil.example/mcp' },
    { ...settings, url: origin + '/mcp?x=1' }, { ...settings, clients: [] }, { ...settings, clients: [client, client] },
    { ...settings, clients: [{ ...client, redirect_uris: ['https://client.example/*'] }] },
    { ...settings, clients: [{ ...client, redirect_uris: ['http://evil.example/callback'] }] },
    { ...settings, clients: [{ ...client, client_secret: 'not-accepted' }] }]) {
    assert.throws(() => config.save(value), { status: 400 });
    assert.equal(config.status(true).restartRequired, false);
    assert.equal(fs.existsSync(path.join(data, 'mcp-settings.json')), false);
  }
  assert.equal(validateMcpConfiguration({ ...settings, url: 'http://localhost:8080/mcp' }, 'http://localhost:8080').enabled, true);
  assert.throws(() => validateMcpConfiguration({ ...settings, url: 'http://gym.local/mcp' }, 'http://gym.local'), { status: 400 });
  assert.equal(createMcpConfiguration({ data, origin: 'http://gym.local', env: {} }).effective.enabled, false);
});

test('MCP settings fail closed on corruption and do not acknowledge failed persistence', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-save-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const config = createMcpConfiguration({ data, origin, env: {} });
  const file = path.join(data, 'mcp-settings.json');
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => config.save(settings));
  assert.equal(config.status(true).restartRequired, false);
  assert.equal(config.status(true).saved.enabled, false);
  fs.writeFileSync(file, '{}');
  assert.throws(() => createMcpConfiguration({ data, origin, env: {} }), /unreadable/);
});
