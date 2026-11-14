// log_workout against a stand-in for the api: a node:http server that answers /api/me and
// /api/data the way api/server.js does, and records what it is sent. What the real server does
// with the write is log-workout.e2e.test.js; the arithmetic is frontend/src/lib/log-workout.test.js.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import { logWorkout, WRITE_LIMIT, _resetWriteWindow } from '../src/write-tools.js'
import { apiBase, apiConfig } from '../src/api-client.js'
import { _seedStateForTests } from '../src/state.js'

const TOKEN = 'tok.secret-value'
const UID = 'u1'
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

let api
// `script.put` answers each PUT in turn; past the end it accepts.
function stubApi(doc, script = {}) {
  const s = { doc: structuredClone(doc), rev: 7, puts: [], gets: 0, auth: [], script }
  const server = http.createServer(async (req, res) => {
    s.auth.push(req.headers.authorization)
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') return send(200, { user: { id: script.uid || UID, name: 'Matt' }, token: 'renewed.secret' })
    if (req.url === '/api/data' && req.method === 'GET') { s.gets++; return send(200, { state: s.doc, rev: s.rev }) }
    if (req.url === '/api/data' && req.method === 'PUT') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      s.puts.push(body)
      const next = (script.put || [])[s.puts.length - 1]
      if (next) return next(send, s)
      if (body.baseRev !== s.rev) return send(409, { error: 'conflict', rev: s.rev, state: s.doc })
      s.doc = body.state
      s.rev++
      return send(200, { ok: true, rev: s.rev })
    }
    send(404, { error: 'not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    s.server = server
    s.env = { OPENGYM_URL: `http://127.0.0.1:${server.address().port}`, OPENGYM_TOKEN: TOKEN }
    resolve(s)
  }))
}
afterEach(() => api?.server.close())
beforeEach(() => _resetWriteWindow())

const DOC = () => ({ unit: 'kg', workouts: [], routines: [{ id: 'r1', name: 'Push', ex: [] }], customEx: [], exWeights: {}, edited: { restSec: 5 }, restSec: 120, _wid: 'w-abc', _ts: 1 })
const CURLS = { exercises: [{ exercise: 'dumbbell curl', sets: [{ reps: 12, weight: 12 }, { reps: 12, weight: 12 }, { reps: 10, weight: 12, failure: true }] }] }
const call = (params, env = api.env) => logWorkout.handler(params, { env })

describe('log_workout writes through the server', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('the document the server sent, plus the workout, with the revision and write id it was read at', async () => {
    const r = await call(CURLS)
    expect(r.logged).toBe(true)
    expect(r.date).toBe(today())
    expect(r.exercises[0]).toMatchObject({ id: '0294', you_said: 'dumbbell curl' })
    expect(r.exercises[0].sets).toHaveLength(3)
    expect(r.exercises[0].sets.map(x => x.label)).toEqual(['12×12', '12×12', '12×10 F'])
    expect(r.exercises[0].sets[2]).toMatchObject({ weight: 12, reps: 10, failure: true })
    expect(api.puts).toHaveLength(1)
    const put = api.puts[0]
    expect(put).toMatchObject({ baseRev: 7, baseWid: 'w-abc' })
    expect(put.stamped).toBeUndefined()
    // nothing the server did not send: no defaults (lang, theme…) for it to stamp as edits
    const { workouts, _ts, ...rest } = put.state
    const { workouts: w0, _ts: t0, ...rest0 } = DOC()
    expect(rest).toEqual({ ...rest0, exWeights: { '0294': { w: 12, d: today() } } })
    expect(workouts).toHaveLength(1)
    expect(_ts).toBeGreaterThan(t0)
    expect(r.revision).toBe(8)
  })

  test('dry_run builds the preview and writes nothing', async () => {
    const r = await call({ ...CURLS, dry_run: true })
    expect(r).toMatchObject({ logged: false, dry_run: true })
    expect(r.would_log.exercises[0].name).toBeTruthy()
    expect(api.puts).toHaveLength(0)
  })

  test('a name with several matches comes back as problems with candidates, and nothing is written', async () => {
    const r = await call({ exercises: [{ exercise: 'lever chest press', sets: [{ reps: 10, weight: 40 }] }] })
    expect(r.logged).toBe(false)
    expect(r.problems[0].candidates.length).toBeGreaterThan(1)
    expect(api.puts).toHaveLength(0)
  })

  test('the same call again is the same workout: no second write', async () => {
    expect((await call(CURLS)).logged).toBe(true)
    const again = await call(CURLS)
    expect(again).toMatchObject({ logged: false, duplicate: true })
    expect(api.puts).toHaveLength(1)
    expect(api.doc.workouts).toHaveLength(1)
  })

  test('a 409 is merged on the document it carries and written again, once', async () => {
    // a phone pushes between the MCP's read and its write
    api.script.put = [(send, s) => {
      s.doc = { ...s.doc, restSec: 90, routines: [...s.doc.routines, { id: 'r2', name: 'Pull', ex: [] }], _wid: 'w-phone' }
      s.rev = 8
      send(409, { error: 'conflict', rev: s.rev, state: s.doc })
    }]
    const r = await call(CURLS)
    expect(r.logged).toBe(true)
    expect(api.puts).toHaveLength(2)
    expect(api.puts[1]).toMatchObject({ baseRev: 8, baseWid: 'w-phone' })
    expect(api.doc.restSec).toBe(90)
    expect(api.doc.routines.map(x => x.id)).toEqual(['r1', 'r2'])
    expect(api.doc.workouts).toHaveLength(1)
    // the retry files the same workout, not one stamped a moment later
    expect(api.puts[1].state.workouts[0].id).toBe(api.puts[0].state.workouts[0].id)
  })

  test('a profile that never stops changing gives up after three tries, saying so', async () => {
    const conflict = (send, s) => { s.rev++; send(409, { error: 'conflict', rev: s.rev, state: s.doc }) }
    api.script.put = [conflict, conflict, conflict]
    await expect(call(CURLS)).rejects.toMatchObject({ code: 'ECONFLICT' })
  })

  test('a rejected token says what to do, and never repeats the token or the renewed one', async () => {
    const err = await call(CURLS, { ...api.env, OPENGYM_TOKEN: 'wrong' }).catch(e => e)
    expect(err.code).toBe('EAUTH')
    expect(err.message).toMatch(/pair again/i)
    expect(err.message).not.toContain('wrong')
    const ok = JSON.stringify(await call(CURLS))
    expect(ok).not.toContain('secret')
  })

  test('a server error and an unreachable server are errors with the status, not a silent no-op', async () => {
    api.script.put = [send => send(500, { error: 'disk full' })]
    await expect(call(CURLS)).rejects.toMatchObject({ code: 'EAPI', message: expect.stringContaining('500: disk full') })
    await expect(call(CURLS, { ...api.env, OPENGYM_URL: 'http://127.0.0.1:1' })).rejects.toMatchObject({ code: 'EAPI' })
  })

  test('a profile with nothing synced yet is told to sign in once, not given a document of one workout', async () => {
    api.doc = null
    await expect(call(CURLS)).rejects.toMatchObject({ code: 'ENOSTATE' })
    expect(api.puts).toHaveLength(0)
  })
})

describe('found in review', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('a 409 from a profile just switched to lb reads the same numbers in the unit first read, as the same workout', async () => {
    api.script.put = [(send, s) => {
      s.doc = { ...s.doc, unit: 'lb', _wid: 'w-lb' }
      s.rev = 8
      send(409, { error: 'conflict', rev: s.rev, state: s.doc })
    }]
    const r = await call({ exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 100 }] }] })
    expect(r.logged).toBe(true)
    const [first, second] = api.puts.map(p => p.state.workouts[0])
    expect(first.entries[0].sets[0].w).toBe(100)
    expect(second.entries[0].sets[0].w).toBe(220.5)
    expect(second.id).toBe(first.id)
  })

  test("the profile's own exercises count as the app counts them: a one-arm dumbbell press logged 'each' is one bell", async () => {
    const own = { id: 'c-oa', n: 'single arm dumbbell press', custom: true, eq: 'dumbbell', bp: 'shoulders', tg: '', desc: '' }
    api.doc = { ...DOC(), customEx: [own], dbLoad: { 'c-oa': { mode: 'each', _ts: 1 } } }
    const r = await call({ exercises: [{ exercise: 'c-oa', sets: [{ reps: 10, weight: 20 }] }] })
    expect(r.logged).toBe(true)
    expect(api.doc.workouts[0].vol).toBe(200)
  })

  test('a custom assisted machine folds towards less help: more help is not a new confirmed weight', async () => {
    const own = { id: 'c-dip', n: 'Assisted Dip (mine)', custom: true, eq: 'custom', bp: 'chest', assisted: true, tg: '', desc: '' }
    api.doc = { ...DOC(), customEx: [own], exWeights: { 'c-dip': { w: 20, d: '2026-10-01' } } }
    const r = await call({ exercises: [{ exercise: 'c-dip', sets: [{ reps: 8, weight: 30 }] }] })
    expect(r.logged).toBe(true)
    expect(api.doc.exWeights['c-dip']).toEqual({ w: 20, d: '2026-10-01' })
  })

  test("a 409 after another device switched a dumbbell default keeps the meaning first read", async () => {
    api.doc = { ...DOC(), dbLoad: { '0289': { mode: 'each', _ts: 1 } } }
    api.script.put = [(send, s) => {
      s.doc = { ...s.doc, dbLoad: { '0289': { mode: 'total', _ts: 2 } }, _wid: 'w-total' }
      s.rev = 8
      send(409, { error: 'conflict', rev: s.rev, state: s.doc })
    }]
    const r = await call({ exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 20 }] }] })
    expect(r.logged).toBe(true)
    const [first, second] = api.puts.map(p => p.state.workouts[0])
    expect(second.entries[0].target.dbLoad).toBe('each')
    expect(second.vol).toBe(first.vol)
    expect(api.doc.dbLoad['0289'].mode).toBe('total')   // the device's new default itself is kept
  })

  test('an /api/me that does not say whose token it is stops the write', async () => {
    const odd = http.createServer((req, res) => {
      if (req.url === '/api/me') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>') }
      res.writeHead(500); res.end()
    })
    await new Promise(r => odd.listen(0, '127.0.0.1', r))
    const err = await call(CURLS, { OPENGYM_URL: `http://127.0.0.1:${odd.address().port}`, OPENGYM_TOKEN: TOKEN }).catch(e => e)
    odd.close()
    expect(err).toMatchObject({ code: 'EAPI', message: expect.stringContaining('/api/me') })
  })

  test('a 409 without the current profile in it is an error, not "sign in once"', async () => {
    api.script.put = [send => send(409, { error: 'conflict' })]
    await expect(call(CURLS)).rejects.toMatchObject({ code: 'EAPI', message: expect.stringContaining('409') })
  })

  test('a token pasted with a line break is refused without being repeated, before any request', async () => {
    const err = await call(CURLS, { ...api.env, OPENGYM_TOKEN: 'abc.def\nsecret-tail' }).catch(e => e)
    expect(err.code).toBe('ENOCONFIG')
    expect(err.message).not.toContain('secret-tail')
    expect(api.auth).toHaveLength(0)
  })

  test('a redirect is not followed: the profile is never replayed to where it points', async () => {
    let followed = 0
    const elsewhere = http.createServer((req, res) => { followed++; res.end('{}') })
    await new Promise(r => elsewhere.listen(0, '127.0.0.1', r))
    const to = `http://127.0.0.1:${elsewhere.address().port}`
    const redirecting = http.createServer((req, res) => { res.writeHead(307, { location: to + req.url }); res.end() })
    await new Promise(r => redirecting.listen(0, '127.0.0.1', r))
    const err = await call(CURLS, { OPENGYM_URL: `http://127.0.0.1:${redirecting.address().port}`, OPENGYM_TOKEN: TOKEN }).catch(e => e)
    redirecting.close(); elsewhere.close()
    expect(err).toMatchObject({ code: 'EAPI', message: expect.stringContaining('redirects (307)') })
    expect(followed).toBe(0)
  })

  test('an OPENGYM_UID that names another profile than the token is refused even when its data is not readable here', async () => {
    api = await stubApi(DOC(), { uid: 'someone-else' })
    process.env.OPENGYM_UID = 'expected-profile'
    try {
      await expect(call(CURLS)).rejects.toMatchObject({ code: 'EPROFILE' })
    } finally { delete process.env.OPENGYM_UID }
    expect(api.puts).toHaveLength(0)
  })
})

describe('limits and the trail a write leaves', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })
  const day = n => { const d = new Date(Date.now() - n * 86400000); return { ...CURLS, start: '07:00', date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') } }

  test('a client looping on log_workout is stopped after WRITE_LIMIT saves, before it even reads the profile', async () => {
    for (let i = 1; i <= WRITE_LIMIT; i++) expect((await call(day(i))).logged).toBe(true)
    const gets = api.gets
    const err = await call(day(WRITE_LIMIT + 1)).catch(e => e)
    expect(err.code).toBe('ERATE')
    expect(err.message).not.toContain('—')
    expect(api.gets).toBe(gets)
    expect(api.puts).toHaveLength(WRITE_LIMIT)
  })

  test('dry runs and duplicates are not saves and do not use the budget up', async () => {
    for (let i = 0; i < WRITE_LIMIT + 2; i++) await call({ ...CURLS, dry_run: true })
    expect((await call(CURLS)).logged).toBe(true)
    for (let i = 0; i < WRITE_LIMIT + 2; i++) expect((await call(CURLS)).duplicate).toBe(true)
    expect((await call(day(3))).logged).toBe(true)
  })

  test('every saved workout leaves one line on stderr for the operator: what, when, which revision, never the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const r = await call(CURLS)
      await call({ ...CURLS, dry_run: true })
      const lines = spy.mock.calls.map(c => c.join(' ')).filter(l => l.includes('log_workout'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(r.workout_id)
      expect(lines[0]).toContain(r.date)
      expect(lines[0]).toContain('rev 8')
      expect(lines[0]).not.toContain(TOKEN)
    } finally { spy.mockRestore() }
  })

  test('what the model reads has no em dashes', () => {
    const texts = [logWorkout.description, ...Object.values(logWorkout.schema).map(z => z.description || '')]
    for (const t of texts) expect(t).not.toContain('—')
  })
})

describe('configuration', () => {
  test('missing config is ENOCONFIG naming both variables', async () => {
    await expect(logWorkout.handler(CURLS, { env: {} })).rejects.toMatchObject({ code: 'ENOCONFIG', message: expect.stringContaining('OPENGYM_TOKEN') })
  })

  test('https, or http only to this machine: the token is a full sign-in', () => {
    expect(apiBase('https://gym.example.com/')).toBe('https://gym.example.com')
    expect(apiBase('https://example.com/gym/')).toBe('https://example.com/gym')
    expect(apiBase('http://localhost:8080')).toBe('http://localhost:8080')
    expect(apiBase('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(apiBase('http://[::1]:8080')).toBe('http://[::1]:8080')
    expect(() => apiBase('http://gym.lan:8080')).toThrow(/https/)
    expect(() => apiBase('http://192.168.1.5')).toThrow(/https/)
    expect(() => apiBase('not a url')).toThrow(/not a URL/)
    expect(() => apiConfig({ OPENGYM_URL: 'http://gym.lan', OPENGYM_TOKEN: 'x' })).toThrow(/https/)
  })
})

// Last: seeding gives state.js a profile of its own for the rest of this file.
describe('the token has to belong to the profile being read', () => {
  test('a token for another profile is refused before anything is read or written', async () => {
    api = await stubApi(DOC(), { uid: 'someone-else' })
    _seedStateForTests(DOC())
    const err = await call(CURLS).catch(e => e)
    expect(err.code).toBe('EPROFILE')
    // the account ids are the operator's (stderr), not the model's
    expect(err.message).not.toContain('someone-else')
    expect(err.message).not.toContain('test-uid')
    expect(api.gets).toBe(0)
    expect(api.puts).toHaveLength(0)
  })
})
