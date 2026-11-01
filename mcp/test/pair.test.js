// pair_opengym against a stand-in for POST /api/pair/redeem: the code goes out, the token comes
// back into a private file and nowhere else, and the write tools then find it without any env.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pairOpengym, createRoutine, _resetWriteWindow } from '../src/write-tools.js'
import { apiBase, apiConfig } from '../src/api-client.js'
import { credentialsPath, loadCredentials } from '../src/credentials.js'

const TOKEN = 'uid1:1893456000:1.macmacmac'
let server, base, dir, env, seen

beforeEach(async () => {
  _resetWriteWindow()
  seen = []
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-pair-'))
  env = { OPENGYM_CREDENTIALS: path.join(dir, 'sub', 'credentials.json') }
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    seen.push({ url: req.url, method: req.method, body: raw ? JSON.parse(raw) : null })
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.url === '/api/pair/redeem') {
      return JSON.parse(raw).code === 'K7WQ2MZP' ? send(200, { token: TOKEN, user: { id: 'uid1', name: 'Matt' } }) : send(400, { error: 'invalid or expired code', code: 'pair-invalid' })
    }
    send(404, { error: 'not found' })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('pair_opengym', () => {
  test('swaps the code for a token, keeps it in a private file, and never says it', async () => {
    const r = await pairOpengym.handler({ code: 'k7wq-2mzp', url: base }, { env })
    expect(r).toMatchObject({ paired: true, profile: 'Matt', url: base })
    expect(JSON.stringify(r)).not.toContain('macmacmac')
    expect(seen[0]).toEqual({ url: '/api/pair/redeem', method: 'POST', body: { code: 'K7WQ2MZP' } })
    const file = env.OPENGYM_CREDENTIALS
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    expect(loadCredentials(env)).toMatchObject({ url: base, token: TOKEN, user: { id: 'uid1', name: 'Matt' } })
  })

  test('the write tools then need no env: the saved pairing is the config', async () => {
    await pairOpengym.handler({ code: 'K7WQ2MZP', url: base }, { env })
    expect(apiConfig(env)).toEqual({ base, token: TOKEN })
    // and the environment still wins when it is set
    expect(apiConfig({ ...env, OPENGYM_URL: base, OPENGYM_TOKEN: 'other.token' }).token).toBe('other.token')
  })

  test('a code the server refuses saves nothing', async () => {
    await expect(pairOpengym.handler({ code: 'WRONGONE', url: base }, { env })).rejects.toMatchObject({ code: 'EPAIR' })
    expect(fs.existsSync(env.OPENGYM_CREDENTIALS)).toBe(false)
  })

  test('something that is not a code never reaches the server', async () => {
    await expect(pairOpengym.handler({ code: 'no no!', url: base }, { env })).rejects.toMatchObject({ code: 'EPAIR' })
    expect(seen).toHaveLength(0)
  })

  test('without an address it asks for one, and renewing reuses the saved one', async () => {
    await expect(pairOpengym.handler({ code: 'K7WQ2MZP' }, { env })).rejects.toMatchObject({ code: 'EPAIR' })
    await pairOpengym.handler({ code: 'K7WQ2MZP', url: base }, { env })
    await expect(pairOpengym.handler({ code: 'K7WQ2MZP' }, { env })).resolves.toMatchObject({ paired: true, url: base })
  })

  test('an unpaired write tool says how to pair, not which variables to edit first', async () => {
    const err = await createRoutine.handler({ name: 'x', exercises: [{ exercise: 'squat', sets: 1, reps: 1 }] }, { env }).catch(e => e)
    expect(err.code).toBe('ENOCONFIG')
    expect(err.message).toContain('pair_opengym')
  })

  test('a redirect is never followed with the code in it', async () => {
    const redirecting = http.createServer((req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end() })
    await new Promise(r => redirecting.listen(0, '127.0.0.1', r))
    const err = await pairOpengym.handler({ code: 'K7WQ2MZP', url: `http://127.0.0.1:${redirecting.address().port}` }, { env }).catch(e => e)
    redirecting.close()
    expect(err.code).toBe('EAPI')
    expect(fs.existsSync(env.OPENGYM_CREDENTIALS)).toBe(false)
  })
})

describe('where openGym may be reached over plain http', () => {
  test('this machine, including *.localhost; nothing else', () => {
    expect(apiBase('http://opengym.docker.localhost')).toBe('http://opengym.docker.localhost')
    expect(apiBase('http://localhost:8080')).toBe('http://localhost:8080')
    expect(() => apiBase('http://localhost.evil.com')).toThrow(/https/)
    expect(() => apiBase('http://gym.lan')).toThrow(/https/)
  })
})

describe('the credentials path', () => {
  test('an explicit path, else the config dir of a HOME, else none', () => {
    expect(credentialsPath({ OPENGYM_CREDENTIALS: '/x/c.json' })).toBe('/x/c.json')
    expect(credentialsPath({ HOME: '/home/u' })).toBe('/home/u/.config/opengym-mcp/credentials.json')
    expect(credentialsPath({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/opengym-mcp/credentials.json')
    expect(credentialsPath({})).toBeNull()
  })
})
