// The HTTP transport the self-hosted container serves: OAuth access tokens issued by the api
// (api/oauth.js, imported here so the two sides cannot drift), each answering for its own profile,
// and every way a grant stops working.
import { describe, beforeAll, afterAll, test, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { issueGrant } from '../../api/oauth.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-'))
const db = {
  users: [{ id: 'ana', name: 'Ana', created: '2026-01-01' }, { id: 'ben', name: 'Ben', created: '2026-01-01' }],
  creds: [], subs: [], invites: []
}
const ana = issueGrant(db, { user: db.users[0], clientId: 'c', clientName: 'Claude' })
const ben = issueGrant(db, { user: db.users[1], clientId: 'c', clientName: 'Claude' })
const writeDb = () => {
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db))
  // A rewrite within the same millisecond would look unchanged to the mtime cache.
  const t = new Date(Date.now() + Math.random() * 1e6)
  fs.utimesSync(path.join(dir, 'db.json'), t, t)
}
writeDb()
fs.writeFileSync(path.join(dir, 'state-ana.json'), JSON.stringify({ routines: [{ id: 'r1', name: 'Ana Push', ex: [] }] }))
fs.writeFileSync(path.join(dir, 'state-ben.json'), JSON.stringify({ routines: [{ id: 'r2', name: 'Ben Legs', ex: [] }] }))

let server, base
beforeAll(async () => {
  vi.stubEnv('OPENGYM_DATA', dir)
  vi.resetModules()
  const { createHandler } = await import('../src/http.js')
  server = http.createServer(createHandler({ origin: 'https://gym.example.com' }))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => {
  await new Promise(r => server.close(r))
  vi.unstubAllEnvs()
  fs.rmSync(dir, { recursive: true, force: true })
})

const rpc = (token, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }, p = '/mcp') =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  })
const routines = async token => {
  const res = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_routines', arguments: {} } })
  expect(res.status).toBe(200)
  return (await res.json()).result.content[0].text
}

describe('http transport', () => {
  test('no token or a wrong one is a 401 that says where to sign in', async () => {
    for (const res of [await rpc(null), await rpc('nope'), await rpc(ana.refresh_token)]) {
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe('Bearer resource_metadata="https://gym.example.com/.well-known/oauth-protected-resource"')
    }
  })

  test('404 outside /mcp', async () => {
    expect((await rpc(ana.access_token, undefined, '/api/data')).status).toBe(404)
    expect((await rpc(ana.access_token, undefined, '/mcp/x')).status).toBe(404)
  })

  test('each token answers for its own profile', async () => {
    const res = await rpc(ana.access_token)
    expect((await res.json()).result.tools.map(t => t.name)).toContain('list_workouts')
    const a = await routines(ana.access_token), b = await routines(ben.access_token)
    expect(a).toContain('Ana Push')
    expect(a).not.toContain('Ben Legs')
    expect(b).toContain('Ben Legs')
    expect(b).not.toContain('Ana Push')
  })

  test('a grant ends with "sign out everywhere", a disabled profile, or its expiry', async () => {
    db.users[0].sv = 1
    writeDb()
    expect((await rpc(ana.access_token)).status).toBe(401)
    expect((await rpc(ben.access_token)).status).toBe(200)

    db.users[1].disabled = true
    writeDb()
    expect((await rpc(ben.access_token)).status).toBe(401)

    db.users[1].disabled = false
    db.oauthGrants.find(g => g.uid === 'ben').aexp = Date.now() - 1
    writeDb()
    expect((await rpc(ben.access_token)).status).toBe(401)
  })
})
