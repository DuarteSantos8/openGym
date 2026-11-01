// create_routine against a stand-in for the api (same shape as write-tools.test.js): what it
// reads, what it writes, and what it refuses. The routine rules are frontend/src/lib/log-routine.test.js.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { createRoutine, updateRoutine, WRITE_TOOLS, _resetWriteWindow } from '../src/write-tools.js'

const TOKEN = 'tok.secret-value'
let api

function stubApi(doc) {
  const s = { doc: structuredClone(doc), rev: 7, puts: [] }
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') return send(200, { user: { id: 'u1', name: 'Matt' } })
    if (req.url === '/api/data' && req.method === 'GET') return send(200, { state: s.doc, rev: s.rev })
    if (req.url === '/api/data' && req.method === 'PUT') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      s.puts.push(body)
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

const DOC = () => ({ unit: 'kg', workouts: [], routines: [], week: {}, customEx: [], exWeights: {}, _wid: 'w-abc', _ts: 1 })
const PLAN = {
  name: 'Forza corpo libero',
  days: ['tuesday', 5],
  exercises: [
    { exercise: '1197', sets: 3, reps: 12 },
    { exercise: '0463', sets: 3, seconds: 25 },
  ],
}
const call = (params, env = api.env) => createRoutine.handler(params, { env })

beforeEach(async () => { _resetWriteWindow(); api = await stubApi(DOC()) })
afterEach(() => api?.server.close())

describe('create_routine writes through the server', () => {
  test('is registered next to log_workout', () => {
    expect(WRITE_TOOLS.map(t => t.name)).toEqual(['log_workout', 'create_routine', 'update_routine', 'pair_opengym'])
  })

  test('the document the server sent, plus the routine on its days, at the revision it was read', async () => {
    const r = await call(PLAN)
    expect(r.created).toBe(true)
    expect(r.exercises.map(e => e.name)).toEqual(['squat', 'front plank'])
    expect(r.days).toEqual([2, 5])
    expect(api.puts).toHaveLength(1)
    const put = api.puts[0]
    expect(put).toMatchObject({ baseRev: 7, baseWid: 'w-abc' })
    expect(put.state.routines).toHaveLength(1)
    expect(put.state.routines[0].ex[1]).toEqual({ id: '0463', sets: 3, mode: 'time', sec: 25 })
    expect(put.state.week).toEqual({ 2: [put.state.routines[0].id], 5: [put.state.routines[0].id] })
    expect(r.revision).toBe(8)
  })

  test('dry_run builds the preview and writes nothing', async () => {
    const r = await call({ ...PLAN, dry_run: true })
    expect(r).toMatchObject({ created: false, dry_run: true })
    expect(r.would_create.exercises).toHaveLength(2)
    expect(api.puts).toHaveLength(0)
  })

  test('an unknown or ambiguous exercise comes back as problems and nothing is written', async () => {
    const r = await call({ name: 'X', exercises: [{ exercise: 'zzzz no such thing', sets: 3, reps: 10 }] })
    expect(r.created).toBe(false)
    expect(r.problems[0].exercise).toBe('zzzz no such thing')
    expect(api.puts).toHaveLength(0)
  })

  test('the same routine again is a duplicate: no second write', async () => {
    expect((await call(PLAN)).created).toBe(true)
    const again = await call(PLAN)
    expect(again).toMatchObject({ created: false, duplicate: true })
    expect(api.puts).toHaveLength(1)
    expect(api.doc.routines).toHaveLength(1)
  })

  test('a day that already has a routine keeps it', async () => {
    api.doc.routines = [{ id: 'old', name: 'Push', ex: [] }]
    api.doc.week = { 2: ['old'] }
    await call(PLAN)
    expect(api.doc.week[2]).toEqual(['old', api.doc.routines[1].id])
  })

  test('a profile with nothing synced yet is told to sign in once', async () => {
    api.doc = null
    await expect(call(PLAN)).rejects.toMatchObject({ code: 'ENOSTATE' })
  })

  test('a rejected token is an error, and never repeats the token', async () => {
    const err = await call(PLAN, { ...api.env, OPENGYM_TOKEN: 'tok.wrong-value' }).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain('wrong-value')
    expect(api.puts).toHaveLength(0)
  })
})

describe('update_routine writes through the server', () => {
  const update = (params, env = api.env) => updateRoutine.handler(params, { env })
  beforeEach(async () => {
    api.doc.routines = [{ id: 'a', name: 'Forza A', ex: [{ id: '1197', sets: 3, reps: 12 }, { id: '0463', sets: 3, mode: 'time', sec: 25 }] }]
    api.doc.week = { 2: ['a'] }
  })

  test('renames and moves days: the saved document differs from the read one by exactly that', async () => {
    const r = await update({ routine: 'forza a', name: 'Forza B', days: ['monday', 'friday'] })
    expect(r).toMatchObject({ updated: true, changed: ['name', 'days'], days: [1, 5], revision: 8 })
    expect(api.puts[0]).toMatchObject({ baseRev: 7, baseWid: 'w-abc' })
    expect(api.doc.routines[0]).toMatchObject({ id: 'a', name: 'Forza B' })
    expect(api.doc.week).toEqual({ 1: ['a'], 5: ['a'] })
  })

  test('add and remove change part of the list, by name', async () => {
    const r = await update({ routine: 'a', add_exercises: [{ exercise: '1241', sets: 3, reps: 8 }], remove_exercises: ['1197'] })
    expect(r.exercises.map(e => e.name)).toEqual(['front plank', 'bird dog'])
    expect(api.doc.routines[0].ex.map(e => e.id)).toEqual(['0463', '1241'])
  })

  test('dry_run shows the result and writes nothing', async () => {
    const r = await update({ routine: 'a', days: [], dry_run: true })
    expect(r).toMatchObject({ updated: false, dry_run: true })
    expect(r.would_update.days).toEqual([])
    expect(api.puts).toHaveLength(0)
  })

  test('an unknown routine, a bad name or nothing to change writes nothing', async () => {
    expect((await update({ routine: 'nope', name: 'x' })).problems[0].field).toBe('routine')
    expect((await update({ routine: 'a' })).unchanged).toBe(true)
    expect(api.puts).toHaveLength(0)
  })
})
