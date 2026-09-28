import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OpenGymOAuthProvider } from '../src/oauth.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-oauth-session-'))
const secret = crypto.randomBytes(32).toString('hex')
fs.writeFileSync(path.join(root, 'secret'), secret)
fs.writeFileSync(path.join(root, 'db.json'), JSON.stringify({ users: [{ id: 'owner', sv: 2 }] }))
const provider = new OpenGymOAuthProvider({ dataDir: root, oauthDir: path.join(root, 'oauth'), resource: new URL('https://mcp.example.com/mcp'), authorizationUrl: new URL('https://gym.example.com/mcp-authorize') })
const token = (version = 2) => {
  const payload = `owner:${Date.now() + 60000}:${version}`
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
}
async function status(cookie) {
  const res = { req: { headers: { cookie }, body: {} }, statusCode: null,
    status(code) { this.statusCode = code; return this }, type() { return this }, send() {} }
  await provider.authorize({ client_id: 'test', redirect_uris: ['https://client.example.com/callback'] }, { redirectUri: 'https://client.example.com/callback', codeChallenge: 'challenge', scopes: ['opengym:read'] }, res)
  return res.statusCode
}
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
describe('API cookie migration compatibility', () => {
  it('accepts the new HTTPS host-only cookie', async () => expect(await status(`__Host-gymsid=${token()}`)).toBe(200))
  it('continues to accept an existing legacy session', async () => expect(await status(`gymsid=${token()}`)).toBe(200))
  it('prefers the host-only cookie over a shadowing legacy cookie', async () => expect(await status(`__Host-gymsid=${token()}; gymsid=invalid`)).toBe(200))
  it('does not fall back when the host-only cookie is invalid', async () => expect(await status(`__Host-gymsid=invalid; gymsid=${token()}`)).toBe(401))
  it('rejects conflicting duplicate cookies', async () => {
    expect(await status(`gymsid=${token()}; gymsid=invalid`)).toBe(401)
    expect(await status(`__Host-gymsid=${token()}; __Host-gymsid=invalid; gymsid=${token()}`)).toBe(401)
  })
  it('continues to reject revoked session versions', async () => expect(await status(`__Host-gymsid=${token(1)}`)).toBe(401))
})
