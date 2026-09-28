import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { OpenGymOAuthProvider } from '../src/oauth.js'

const roots = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-grants-')); roots.push(root)
  const data = path.join(root, 'data'), oauth = path.join(root, 'oauth'); fs.mkdirSync(data)
  const users = [{ id: 'owner', name: 'Owner', sv: 0 }, { id: 'other', name: 'Other', sv: 0 }]
  fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ users }))
  fs.writeFileSync(path.join(data, 'secret'), 'secret')
  const provider = new OpenGymOAuthProvider({ dataDir: data, oauthDir: oauth, resource: new URL('https://mcp.example/mcp'), authorizationUrl: new URL('https://gym.example/api/mcp/authorize') })
  return { provider, secret: 'secret', data, users }
}
function cookie(secret, uid = 'owner') {
  const payload = `${uid}:${Date.now() + 60_000}:0`
  return `__Host-gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
}
async function connect(provider, secret, { mode = 'read', body: extraBody = {} } = {}) {
  let location
  const req = { method: 'GET', headers: { cookie: cookie(secret), origin: 'https://gym.example' }, body: {} }
  let html
  const res = { req, status() { return this }, type() { return this }, send(value) { html = value }, redirect: (...args) => { location = args.at(-1) } }
  const client = { client_id: 'claude', client_name: 'Claude', redirect_uris: ['https://claude.ai/callback'] }
  const params = { redirectUri: client.redirect_uris[0], codeChallenge: 'challenge', scopes: ['opengym:read', 'opengym:write'], resource: new URL('https://mcp.example/mcp') }
  await provider.authorize(client, params, res)
  req.method = 'POST'
  req.body = { approve: 'yes', mode, consent_nonce: html.match(/name="consent_nonce" value="([^"]+)"/)[1], ...extraBody }
  await provider.authorize(client, params, res)
  const code = new URL(location).searchParams.get('code')
  const tokens = await provider.exchangeAuthorizationCode(client, code, 'unused', client.redirect_uris[0], new URL('https://mcp.example/mcp'))
  return { client, tokens, req, res, params, location }
}

describe('OAuth connections', () => {
  it('defaults to read-only and binds the grant to the approving user', async () => {
    const { provider, secret } = setup()
    const { tokens } = await connect(provider, secret)
    const auth = await provider.verifyAccessToken(tokens.access_token)
    expect(auth.scopes).toEqual(['opengym:read'])
    expect(auth.extra.userId).toBe('owner')
  })
  it('ignores any other account named in the consent form', async () => {
    const { provider, secret } = setup()
    const { tokens } = await connect(provider, secret, { mode: 'write', body: { uid: 'other', profile: ['other'] } })
    const auth = await provider.verifyAccessToken(tokens.access_token)
    expect(auth.extra.userId).toBe('owner')
    expect(JSON.stringify(provider.store)).not.toContain('"other"')
  })
  it('identifies the authorization issuer in the callback', async () => {
    const { provider, secret } = setup()
    const { location } = await connect(provider, secret)
    expect(new URL(location).searchParams.get('iss')).toBe('https://gym.example/')
  })
  // Browsers apply form-action to the redirect after the submission as well, so it would block
  // the 303 to the client's callback.
  it('sends no form-action CSP on the consent page or its redirect', async () => {
    const { provider, secret } = setup()
    const headers = {}
    const req = { method: 'GET', headers: { cookie: cookie(secret), origin: 'https://gym.example' }, body: {} }
    let html
    const res = { req, status() { return this }, type() { return this }, set(name, value) { headers[name] = value; return this }, send(value) { html = value }, redirect() {} }
    const client = { client_id: 'claude', client_name: 'Claude', redirect_uris: ['https://claude.ai/callback'] }
    const params = { redirectUri: client.redirect_uris[0], codeChallenge: 'challenge', scopes: ['opengym:read'], resource: new URL('https://mcp.example/mcp') }
    await provider.authorize(client, params, res)
    expect(headers['Content-Security-Policy']).not.toContain('form-action')
    req.method = 'POST'
    req.body = { approve: 'yes', mode: 'read', consent_nonce: html.match(/name="consent_nonce" value="([^"]+)"/)[1] }
    delete headers['Content-Security-Policy']
    await provider.authorize(client, params, res)
    expect(headers['Content-Security-Policy']).toBeUndefined()
  })
  it('permits offline_access without treating it as training-data write access', async () => {
    const { provider, secret } = setup()
    let html
    const req = { method: 'GET', headers: { cookie: cookie(secret), origin: 'https://gym.example' }, body: {} }
    const res = { req, status() { return this }, type() { return this }, send(value) { html = value } }
    await provider.authorize(
      { client_id: 'chatgpt', redirect_uris: ['https://chatgpt.com/callback'] },
      { redirectUri: 'https://chatgpt.com/callback', codeChallenge: 'challenge', scopes: ['opengym:read', 'offline_access'], resource: new URL('https://mcp.example/mcp') },
      res
    )
    expect(html).toContain('Read only')
    expect(html).not.toContain('Read and write')
  })
  it('revokes every token for a connection', async () => {
    const { provider, secret } = setup()
    const { tokens, client } = await connect(provider, secret, { mode: 'write' })
    const user = provider.sessionUser({ headers: { cookie: cookie(secret) } })
    const id = provider.manage(user).connections[0].id
    provider.revokeConnection(user, id)
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow(/Invalid/)
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token)).rejects.toThrow()
  })
  it('rejects reusing a consent form and rejects a foreign Origin', async () => {
    const { provider, secret } = setup()
    const { client, req, res, params } = await connect(provider, secret)
    await expect(provider.authorize(client, params, res)).rejects.toThrow(/consent/)
    req.body = {}; req.method = 'GET'
    let html; res.send = value => { html = value }
    await provider.authorize(client, params, res)
    req.method = 'POST'; req.headers.origin = 'https://attacker.example'
    req.body = { approve: 'yes', consent_nonce: html.match(/name="consent_nonce" value="([^"]+)"/)[1] }
    await expect(provider.authorize(client, params, res)).rejects.toThrow(/consent/)
  })
  it('accepts Origin: null when Sec-Fetch-Site says same-origin (Safari after a cross-site redirect)', async () => {
    const { provider, secret } = setup()
    const { client, req, res, params } = await connect(provider, secret)
    req.body = {}; req.method = 'GET'
    let html; res.send = value => { html = value }
    await provider.authorize(client, params, res)
    req.method = 'POST'; req.headers.origin = 'null'; req.headers['sec-fetch-site'] = 'same-origin'
    req.body = { approve: 'yes', consent_nonce: html.match(/name="consent_nonce" value="([^"]+)"/)[1] }
    let location
    res.redirect = (...args) => { location = args.at(-1) }
    await provider.authorize(client, params, res)
    expect(new URL(location).searchParams.get('code')).toBeTruthy()
  })
  it('falls back to Origin when Sec-Fetch-Site is absent', async () => {
    const { provider, secret } = setup()
    const { client, req, res, params } = await connect(provider, secret)
    req.body = {}; req.method = 'GET'
    let html; res.send = value => { html = value }
    await provider.authorize(client, params, res)
    req.method = 'POST'; req.headers.origin = 'null'; delete req.headers['sec-fetch-site']
    req.body = { approve: 'yes', consent_nonce: html.match(/name="consent_nonce" value="([^"]+)"/)[1] }
    await expect(provider.authorize(client, params, res)).rejects.toThrow(/consent/)
  })
  it('does not let another user consume an approval and makes approval one-use', async () => {
    const { provider, secret } = setup()
    const { tokens } = await connect(provider, secret, { mode: 'write' })
    const auth = await provider.verifyAccessToken(tokens.access_token)
    const pending = provider.requestApproval(auth, { name: 'delete_bodyweight' }, { date: '2026-08-01', expected_version: 10, confirm: true })
    expect(() => provider.consumeApproval({ id: 'other' }, pending.approval_id)).toThrow(/not found/)
    const request = provider.consumeApproval({ id: 'owner' }, pending.approval_id)
    expect(request.params).not.toHaveProperty('confirm')
    expect(request.params.expected_version).toBe(10)
    expect(() => provider.consumeApproval({ id: 'owner' }, pending.approval_id)).toThrow(/not found/)
  })
  it('invalidates tokens after sign-out-everywhere or disabling a profile', async () => {
    const { provider, secret, data, users } = setup()
    const { tokens } = await connect(provider, secret)
    users[0].sv++
    fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ users }))
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow()
  })

  it('does not escalate a read-only connection when refreshing', async () => {
    const { provider, secret } = setup()
    const { tokens, client } = await connect(provider, secret)
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token, ['opengym:read', 'opengym:write'])).rejects.toThrow(/scope exceeds/)
  })
})
