// The connector sign-in end to end, the way Claude and ChatGPT run it (sub-connect-146): the
// official MCP SDK client, with no token at all, gets the 401, follows its resource_metadata
// pointer, reads the authorization server's metadata, registers itself, sends the "browser" to
// openGym's consent page, gets the code back and trades it, then calls a tool. Later its access
// token goes stale and the SDK renews it with the refresh token on its own.
//
// One small proxy plays the web container: /mcp to the mcp handler, everything else to the real
// api/server.js in a child process, all on one origin as in production.
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api')
const HAVE_API = fs.existsSync(path.join(API, 'node_modules', '@simplewebauthn', 'server'))
if (!HAVE_API && process.env.CI) throw new Error('api/node_modules is missing: run `npm ci` in api/ before the MCP tests in CI')

const SECRET = crypto.randomBytes(32).toString('hex')
const UID = 'u_oauth_a'
const cookie = () => {
  const payload = `${UID}:${Date.now() + 86400000}:0:c`
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}
const DOC = {
  unit: 'kg', restSec: 120,
  routines: [{ id: 'r1', name: 'Ana push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100, mode: 'reps', restSec: 180 }], _ts: 1000 }],
  week: { 1: ['r1'] }, workouts: [], exWeights: {}, customEx: [], bodyweight: [], _rev: 5, _wid: 'w-seed', _ts: 1000,
}
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

// What an assistant keeps between calls: its registration, its tokens, the PKCE verifier.
function assistant() {
  const s = {}
  return {
    s,
    get redirectUrl() { return REDIRECT },
    get clientMetadata() { return { client_name: 'Claude', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' } },
    clientInformation: () => s.client,
    saveClientInformation: c => { s.client = c },
    tokens: () => s.tokens,
    saveTokens: t => { s.tokens = t },
    redirectToAuthorization: u => { s.authUrl = u },
    saveCodeVerifier: v => { s.verifier = v },
    codeVerifier: () => s.verifier,
  }
}

let child, dataDir, front, origin, log = ''

describe.skipIf(!HAVE_API)('the connector sign-in with the official MCP client', () => {
  beforeAll(async () => {
    // The front first: the api needs its address as ORIGIN.
    let apiPort = 0, handle = null
    front = http.createServer((req, res) => {
      if (req.url.split('?')[0] === '/mcp') return handle(req, res)
      const up = http.request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
      up.on('error', () => { res.writeHead(502); res.end() })
      req.pipe(up)
    })
    await new Promise(r => front.listen(0, '127.0.0.1', r))
    origin = `http://localhost:${front.address().port}`
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-oauth-'))
    fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 })
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'Ana', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }))
    fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify(DOC))
    child = spawn(process.execPath, ['server.js'], {
      cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: origin, RP_ID: 'localhost', MCP: 'on' },
    })
    child.stderr.on('data', d => { log += d })
    apiPort = await new Promise((resolve, reject) => {
      const give = setTimeout(() => reject(new Error('server never announced a port:\n' + log)), 20000)
      child.stdout.on('data', d => { log += d; const m = /gym-api on :(\d+)/.exec(log); if (m) { clearTimeout(give); resolve(+m[1]) } })
      child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${log}`)) })
    })
    delete process.env.OPENGYM_DATA
    const { createMcpHandler } = await import('../src/http.js')
    handle = createMcpHandler({ apiUrl: `http://127.0.0.1:${apiPort}`, allowedOrigins: [origin], publicOrigin: origin })
  }, 30000)
  afterAll(() => { child?.kill('SIGKILL'); front?.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  test('401, discovery, registration, consent, code, tools, and a silent refresh', async () => {
    const me = assistant()
    const url = new URL(origin + '/mcp')
    const first = new StreamableHTTPClientTransport(url, { authProvider: me })
    await expect(new Client({ name: 'Claude', version: '1' }).connect(first)).rejects.toThrow(UnauthorizedError)
    // It registered itself and wants the browser at openGym's authorize address, with PKCE,
    // the resource it is signing in to and offline_access for a refresh token.
    expect(me.s.client.client_id).toMatch(/^ogc_/)
    const az = me.s.authUrl
    expect(az.origin + az.pathname).toBe(origin + '/api/oauth/authorize')
    expect(az.searchParams.get('code_challenge_method')).toBe('S256')
    expect(az.searchParams.get('resource')).toBe(origin + '/mcp')
    expect(az.searchParams.get('scope')).toContain('offline_access')

    // The person: the authorize address sends them to the consent page, they say yes.
    const hop = await fetch(az, { redirect: 'manual' })
    expect(hop.status).toBe(302)
    const id = hop.headers.get('location').split('/#/connect/')[1]
    const consent = { Cookie: cookie(), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }
    const asked = await (await fetch(origin + '/api/oauth/request?id=' + id, { headers: consent })).json()
    expect(asked.assistant).toBe('claude')
    expect(asked.scopes).toMatchObject({ workouts: 'view', plans: 'apply', bodyweight: 'view' })
    const ok = await (await fetch(origin + '/api/oauth/approve', { method: 'POST', headers: consent, body: JSON.stringify({ id, scopes: asked.scopes, days: 0 }) })).json()
    const back = new URL(ok.redirect)
    expect(back.origin + back.pathname).toBe(REDIRECT)
    expect(back.searchParams.get('iss')).toBe(origin)

    // The assistant's callback: the code for tokens.
    await first.finishAuth(back.searchParams.get('code'))
    expect(me.s.tokens.access_token).toMatch(/^ogt_/)
    expect(me.s.tokens.refresh_token).toMatch(/^ogr_/)

    const client = new Client({ name: 'Claude', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: me }))
    const names = (await client.listTools()).tools.map(t => t.name)
    expect(names).toContain('list_routines')
    expect(names).toContain('create_routine')
    expect(names).toContain('search_exercises')
    const r = await client.callTool({ name: 'list_routines', arguments: {} })
    expect(r.content[0].text).toContain('Ana push')
    await client.close()

    // The access token goes bad (a day later, say): the next call gets the 401, the SDK renews
    // with the refresh token and carries on, and the refresh token rotated.
    const oldRefresh = me.s.tokens.refresh_token
    me.s.tokens = { ...me.s.tokens, access_token: 'ogt_' + 'z'.repeat(43) }
    const again = new Client({ name: 'Claude', version: '1' })
    await again.connect(new StreamableHTTPClientTransport(url, { authProvider: me }))
    const r2 = await again.callTool({ name: 'list_routines', arguments: {} })
    expect(r2.content[0].text).toContain('Ana push')
    expect(me.s.tokens.refresh_token).not.toBe(oldRefresh)
    await again.close()

    // In Settings it is one connection, made by Claude, used.
    const list = await (await fetch(origin + '/api/tokens', { headers: consent })).json()
    const rows = list.tokens.filter(t => t.connector)
    expect(rows).toHaveLength(1)
    expect(rows[0].connector.assistant).toBe('claude')
    expect(rows[0].used).toBeTruthy()
  }, 30000)
})
