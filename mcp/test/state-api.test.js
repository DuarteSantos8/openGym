// Tests for state.js reading through the api (OPENGYM_URL + OPENGYM_TOKEN, no OPENGYM_DATA):
// against a node:http stand-in that answers /api/me, /api/data and /api/data/rev the way
// api/server.js does, and counts what it is asked. state.js caches module-globally, so each
// case imports a fresh copy with its own env.
import { describe, test, expect, afterEach, vi } from 'vitest'
import http from 'node:http'

const TOKEN = 'tok.secret-value'

let api
function stubApi(doc, { rev = 3 } = {}) {
  const s = { doc, rev, hits: { me: 0, data: 0, rev: 0 } }
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') { s.hits.me++; return send(200, { user: { id: 'u1', name: 'Matt' } }) }
    if (req.url === '/api/data') { s.hits.data++; return send(200, { state: s.doc, rev: s.doc ? s.rev : 0 }) }
    if (req.url === '/api/data/rev') { s.hits.rev++; return send(200, { rev: s.rev, ...(s.doc?._wid ? { wid: s.doc._wid } : {}) }) }
    send(404, { error: 'not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    s.server = server
    s.url = `http://127.0.0.1:${server.address().port}`
    resolve(s)
  }))
}

async function load(env) {
  vi.resetModules()
  for (const [k, v] of Object.entries({ OPENGYM_DATA: '', OPENGYM_UID: '', OPENGYM_URL: api.url, OPENGYM_TOKEN: TOKEN, ...env })) vi.stubEnv(k, v)
  return import('../src/state.js')
}

afterEach(() => { vi.unstubAllEnvs(); api?.server.close() })

const DOC = () => ({ unit: 'lb', routines: [{ id: 'r1', name: 'Push', ex: [] }], workouts: [], _wid: 'w-1' })

describe('reading through the api', () => {
  test('the profile and whose it is come from the server, with the defaults merged in', async () => {
    api = await stubApi(DOC())
    const st = await load()
    expect(st.apiMode()).toBe(true)
    await st.refresh()
    expect(st.getUser()).toEqual({ id: 'u1', name: 'Matt', created: null })
    expect(st.getState().unit).toBe('lb')
    expect(st.getState().routines[0].name).toBe('Push')
    expect(st.getState().restSec).toBe(90)
    expect(st.localUid()).toBeNull()
  })

  test('an unchanged revision is one cheap call, not another download', async () => {
    api = await stubApi(DOC())
    const st = await load()
    await st.refresh()
    await st.refresh()
    await st.refresh()
    expect(api.hits).toEqual({ me: 1, data: 1, rev: 2 })
  })

  test('a new revision, or the same one with another write id, downloads the profile again', async () => {
    api = await stubApi(DOC())
    const st = await load()
    await st.refresh()
    api.rev = 4
    api.doc = { ...DOC(), unit: 'kg', _wid: 'w-2' }
    await st.refresh()
    expect(st.getState().unit).toBe('kg')
    // A restored backup: the revision it carries was seen before, the write id was not.
    api.doc = { ...DOC(), targetW: 80, _wid: 'w-restored' }
    await st.refresh()
    expect(st.getState().targetW).toBe(80)
    expect(api.hits.data).toBe(3)
  })

  test('invalidate() after a write makes the next read download', async () => {
    api = await stubApi(DOC())
    const st = await load()
    await st.refresh()
    st.invalidate()
    await st.refresh()
    expect(api.hits.data).toBe(2)
  })

  test('a profile that never synced reads as null, as a missing state file does', async () => {
    api = await stubApi(null)
    const st = await load()
    await st.refresh()
    expect(st.getState()).toBeNull()
  })

  test('a token the server refuses is EAUTH, and the token is not in the message', async () => {
    api = await stubApi(DOC())
    const st = await load({ OPENGYM_TOKEN: 'tok.wrong-secret' })
    const err = await st.refresh().catch(e => e)
    expect(err.code).toBe('EAUTH')
    expect(err.message).not.toContain('wrong-secret')
  })

  test('a read before refresh() is an error, not an empty profile', async () => {
    api = await stubApi(DOC())
    const st = await load()
    expect(() => st.getState()).toThrow(/refresh/)
  })

  test('with OPENGYM_DATA set the data folder wins and nothing goes over the network', async () => {
    api = await stubApi(DOC())
    const st = await load({ OPENGYM_DATA: '/nonexistent-opengym-data' })
    expect(st.apiMode()).toBe(false)
    await st.refresh()
    expect(api.hits).toEqual({ me: 0, data: 0, rev: 0 })
  })

  test('a read tool answers from the downloaded profile', async () => {
    api = await stubApi(DOC())
    const st = await load()
    const { TOOLS } = await import('../src/tools.js')
    await st.refresh()
    const out = TOOLS.find(t => t.name === 'list_routines').handler({})
    expect(JSON.stringify(out)).toContain('Push')
  })
})
