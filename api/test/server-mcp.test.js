import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

for (const resource of ['http://localhost:8080/mcp', 'https://gym.example/gym/mcp'])
test('Remote MCP OAuth binds PKCE, scopes, accounts and revocation without exposing app sessions at ' + resource, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-remote-mcp-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(directory, 'secret'), secret);
  fs.writeFileSync(path.join(directory, 'db.json'), JSON.stringify({ users: [
    { id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'admin', name: 'Admin', admin: true }
  ], creds: [], subs: [], invites: [] }));
  for (const id of ['alice', 'bob']) fs.writeFileSync(path.join(directory, `state-${id}.json`), JSON.stringify({
    unit: 'kg', routines: [{ id: 'r1', name: id + ' routine', ex: [] }], customEx: []
  }));
  const mint = uid => {
    const payload = `${uid}:${Date.now() + 600000}:0`;
    return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  };
  let child, log, base;
  const origin = new URL(resource).origin;
  const prefix = new URL(resource).pathname.slice(0, -'/mcp'.length);
  const issuer = origin + prefix + '/oauth';
  async function start() {
    log = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env: { ...process.env, PORT: '0', DATA_DIR: directory, ORIGIN: origin, MCP_ENABLED: '1', MCP_PUBLIC_URL: resource,
        MCP_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'test-client', redirect_uris: ['https://client.example/callback'] }]) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', bytes => log += bytes);
    child.stderr.on('data', bytes => log += bytes);
    try { base = `http://127.0.0.1:${await boundPort(child, () => log)}`; }
    catch (error) { throw new Error(log, { cause: error }); }
  }
  async function stop() {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  }
  t.after(async () => { await stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await start();
  // Explicit virtual-host requests: Node fetch may replace Host with the ephemeral listener.
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const internalUrl = prefix && url.startsWith(prefix + '/') ? url.slice(prefix.length) : url;
    const outgoing = httpRequest(base + internalUrl, { method: options.method || 'GET',
      headers: { Host: new URL(resource).host, 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http', ...options.headers } }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        const response = new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers });
        Object.defineProperty(response, 'url', { value: base + url });
        resolve(response);
      });
    });
    outgoing.on('error', reject);
    outgoing.end(options.body?.toString());
  });
  const rpc = (token, method, params = {}, protocolVersion) => request('/mcp', { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion, 'Mcp-Method': method } : {})
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params,
    ...(protocolVersion ? { _meta: { 'io.modelcontextprotocol/protocolVersion': protocolVersion,
      'io.modelcontextprotocol/clientInfo': { name: 'OpenGym test', version: '1.0.0' },
      'io.modelcontextprotocol/clientCapabilities': {} } } : {}) } }) });
  const mcpJson = async response => {
    const text = await response.text();
    const data = response.headers.get('content-type')?.startsWith('text/event-stream')
      ? /^data: (.+)$/m.exec(text)?.[1] : text;
    return JSON.parse(data);
  };
  const unauthenticated = await request('/mcp', { method: 'POST', headers: { Cookie: 'gymsid=' + mint('alice') } });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get('www-authenticate'), /oauth-protected-resource/);
  const discovery = await request('/.well-known/oauth-authorization-server');
  const metadata = await discovery.json();
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.equal(metadata.issuer, issuer);
  assert.equal((await request('/api/mcp/settings')).status, 401);
  const userSettings = await (await request('/api/mcp/settings', { headers: { Cookie: 'gymsid=' + mint('alice') } })).json();
  assert.equal(userSettings.enabled, true);
  assert.equal(userSettings.saved, undefined);
  assert.equal(userSettings.clients[0].redirect_uris, undefined);
  const configuration = { enabled: false, url: resource, clients: [
    { client_id: 'test-client', redirect_uris: ['https://client.example/callback'] }
  ] };
  const saveSettings = (uid, value, requestOrigin = origin) => request('/api/mcp/settings', { method: 'PUT',
    headers: { Cookie: 'gymsid=' + mint(uid), Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await saveSettings('alice', configuration)).status, 403);
  assert.equal((await saveSettings('admin', configuration, 'https://evil.example')).status, 403);
  assert.equal((await saveSettings('admin', { ...configuration, url: 'https://evil.example/mcp' })).status, 400);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
  const authParams = { client_id: 'test-client', redirect_uri: 'https://client.example/callback',
    response_type: 'code', scope: 'training.read', resource };
  const noPkce = await request('/oauth/auth?' + new URLSearchParams(authParams));
  assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
  const badRedirect = await request('/oauth/auth?' + new URLSearchParams({ ...authParams, redirect_uri: 'https://evil.example/callback' }));
  assert.equal(badRedirect.status, 400);
  assert.equal(badRedirect.headers.get('location'), null);
  const wrongResource = await request('/oauth/auth?' + new URLSearchParams({ ...authParams, resource: 'https://evil.example/mcp',
    code_challenge: crypto.randomBytes(32).toString('base64url'), code_challenge_method: 'S256' }));
  assert.equal(wrongResource.status, 303);
  assert.equal(new URL(wrongResource.headers.get('location')).searchParams.get('error'), 'invalid_target');

  async function connect(uid, scope, wrongProof = false) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const jar = new Map([['gymsid', mint(uid)]]);
    const fetchBrowser = async (url, options = {}) => {
      const result = await request(url, { ...options, headers: { ...options.headers,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } });
      for (const value of result.headers.getSetCookie()) {
        const pair = value.split(';')[0]; const separator = pair.indexOf('=');
        jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return result;
    };
    let response = await fetchBrowser('/oauth/auth?' + new URLSearchParams({ client_id: 'test-client',
      redirect_uri: 'https://client.example/callback', response_type: 'code', scope: scope + ' offline_access',
      resource, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', state: 'test-state', prompt: 'consent' }));
    if (origin.startsWith('https:')) assert.match(response.headers.getSetCookie().join(';'), /; secure;/i);
    let code;
    for (let step = 0; step < 12; step++) {
      const location = response.headers.get('location');
      if (location?.startsWith('https://client.example/callback')) {
        const callback = new URL(location);
        assert.equal(callback.searchParams.get('state'), 'test-state');
        assert.equal(callback.searchParams.get('iss'), issuer);
        assert.equal(callback.searchParams.get('error'), null, callback.toString());
        code = callback.searchParams.get('code'); break;
      }
      if (location) {
        assert.equal(new URL(location, origin).origin, origin);
        response = await fetchBrowser(new URL(location, origin).pathname + new URL(location, origin).search); continue;
      }
      const html = await response.text();
      assert.equal(response.status, 200, response.url + '\n' + html + '\n' + log);
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      assert.ok(csrf, html);
      response = await fetchBrowser(new URL(response.url).pathname, { method: 'POST', headers: {
        'Content-Type': 'application/x-www-form-urlencoded', Origin: origin
      }, body: new URLSearchParams({ csrf, decision: 'allow' }) });
    }
    assert.ok(code, log);
    const exchange = await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'test-client', code,
        code_verifier: wrongProof ? 'wrong-verifier-'.repeat(4) : verifier,
        redirect_uri: 'https://client.example/callback', resource }) });
    const tokens = await exchange.json();
    if (wrongProof) {
      assert.equal(exchange.status, 400);
      assert.equal(tokens.error, 'invalid_grant');
      assert.equal(tokens.access_token, undefined);
      return;
    }
    assert.equal(exchange.status, 200, JSON.stringify(tokens) + '\n' + log);
    assert.ok(tokens.access_token); assert.ok(tokens.refresh_token);
    assert.equal(tokens.token, undefined);
    return tokens;
  }
  const alice = await connect('alice', 'training.read');
  const bob = await connect('bob', 'training.read');
  for (const [tokens, name] of [[alice, 'alice routine'], [bob, 'bob routine']]) {
    const response = await rpc(tokens.access_token, 'tools/call', { name: 'list_routines', arguments: {} });
    const result = await mcpJson(response);
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.result.structuredContent.routines[0].name, name);
  }
  const list = await mcpJson(await rpc(alice.access_token, 'tools/list'));
  assert.equal(list.result.tools.length, 16);
  const discovered = await mcpJson(await rpc(alice.access_token, 'server/discover', {}, '2026-07-28'));
  assert.ok(discovered.result.supportedVersions.includes('2026-07-28'));
  assert.equal(discovered.result._meta['io.modelcontextprotocol/serverInfo'].name, 'opengym');
  const modern = await rpc(alice.access_token, 'tools/list', {}, '2026-07-28');
  assert.equal(modern.status, 200);
  assert.equal((await mcpJson(modern)).result.tools.length, 16);
  assert.equal(modern.headers.get('mcp-session-id'), null);
  assert.deepEqual(list.result.tools.find(tool => tool.name === 'nutrition_create_entry')._meta.securitySchemes,
    [{ type: 'oauth2', scopes: ['nutrition.write'] }]);
  const denied = await mcpJson(await rpc(alice.access_token, 'tools/call', {
    name: 'nutrition_get_diary', arguments: { date: '2026-10-13' }
  }));
  assert.equal(denied.result.isError, true);
  assert.equal(denied.result.structuredContent.code, 'insufficient_scope');
  assert.match(denied.result._meta['mcp/www_authenticate'][0], /scope="nutrition.read"/);
  assert.equal((await request('/api/me', { headers: { Authorization: 'Bearer ' + alice.access_token } })).status, 401);
  assert.equal((await rpc(mint('alice'), 'tools/list')).status, 401);
  assert.equal((await request('/mcp', { method: 'POST', headers: { Origin: 'https://evil.example', Authorization: 'Bearer ' + alice.access_token } })).status, 403);
  await stop(); await start();
  assert.equal((await rpc(alice.access_token, 'tools/list')).status, 200);
  const connections = await (await request('/api/mcp/connections', { headers: { Cookie: 'gymsid=' + mint('alice') } })).json();
  assert.equal(connections.connections.length, 1);
  const grantId = connections.connections[0].grantId;
  assert.equal((await request('/api/mcp/connections/revoke', { method: 'POST', headers: {
    Cookie: 'gymsid=' + mint('bob'), 'Content-Type': 'application/json'
  }, body: JSON.stringify({ grantId }) })).status, 404);
  assert.equal((await request('/api/mcp/connections/revoke', { method: 'POST', headers: {
    Cookie: 'gymsid=' + mint('alice'), 'Content-Type': 'application/json'
  }, body: JSON.stringify({ grantId }) })).status, 200);
  assert.equal((await rpc(alice.access_token, 'tools/list')).status, 401);
  assert.equal((await rpc(bob.access_token, 'tools/list')).status, 200);
  const refresh = token => request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'test-client', refresh_token: token, resource }) });
  const revokedRefresh = await refresh(alice.refresh_token);
  assert.equal(revokedRefresh.status, 400);
  assert.equal((await revokedRefresh.json()).error, 'invalid_grant');
  const refreshed = await refresh(bob.refresh_token);
  assert.equal(refreshed.status, 200);
  const rotated = await refreshed.json();
  assert.notEqual(rotated.refresh_token, bob.refresh_token);
  assert.equal((await rpc(rotated.access_token, 'tools/list')).status, 200);
  const replayTokens = await connect('bob', 'training.read');
  const firstRefresh = await refresh(replayTokens.refresh_token);
  assert.equal(firstRefresh.status, 200);
  const latest = await firstRefresh.json();
  const repeated = await refresh(replayTokens.refresh_token);
  assert.equal(repeated.status, 400);
  assert.equal((await repeated.json()).error, 'invalid_grant');
  assert.equal((await rpc(latest.access_token, 'tools/list')).status, 401);
  await request('/api/logout/all', { method: 'POST', headers: { Authorization: 'Bearer ' + mint('bob'), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await rpc(bob.access_token, 'tools/list')).status, 401);
  assert.equal((await rpc(rotated.access_token, 'tools/list')).status, 401);
  assert.equal((await refresh(rotated.refresh_token)).status, 400);
  await connect('alice', 'training.read', true);
  const savedSettings = await saveSettings('admin', configuration);
  assert.equal(savedSettings.status, 200);
  const pending = await savedSettings.json();
  assert.equal(pending.enabled, true);
  assert.equal(pending.saved.enabled, false);
  assert.equal(pending.restartRequired, true);
  await stop(); await start();
  assert.equal((await rpc(alice.access_token, 'tools/list')).status, 404);
  const applied = await (await request('/api/mcp/settings', { headers: { Cookie: 'gymsid=' + mint('admin') } })).json();
  assert.equal(applied.enabled, false);
  assert.equal(applied.restartRequired, false);
  const retained = await (await request('/api/mcp/connections', { headers: { Cookie: 'gymsid=' + mint('alice') } })).json();
  assert.ok(retained.connections.length > 0);
  const removed = await request('/api/mcp/connections/revoke', { method: 'POST', headers: {
    Cookie: 'gymsid=' + mint('alice'), Origin: origin, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ grantId: retained.connections[0].grantId }) });
  assert.equal(removed.status, 200);
});
