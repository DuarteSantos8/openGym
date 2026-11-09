// The profile read through the api instead of the data folder (remote.js, #880), against a stand-in
// api: which routes each kind of token reads, that the document is fetched again only when the
// revision moved, and that two profiles read at once stay apart (withProfile).
import { describe, test, expect, afterEach } from 'vitest'
import http from 'node:http'
import { createRemoteProfile } from '../src/remote.js'
import { withProfile, getState, getUser } from '../src/state.js'
import { listRoutines } from '../src/tools.js'
import { toolAllowed, ALL_TOOLS, TOOL_NEEDS } from '../src/server.js'

let srv
afterEach(() => srv?.close())
function stub(docs) {
  const hits = []
  srv = http.createServer((req, res) => {
    hits.push(req.method + ' ' + req.url)
    const send = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
    const who = docs[(req.headers.authorization || '').slice(7)]
    if (!who) return send(401, { error: 'no' })
    if (req.url === '/api/me' || req.url === '/api/token/me') return send(200, { user: { id: who.id, name: who.id }, ...(req.url.includes('token') ? { token: { scopes: { plans: 'view' } } } : {}) })
    if (req.url.endsWith('/data/rev')) return send(200, { rev: who.rev })
    if (req.url.endsWith('/data')) return send(200, { state: who.doc, rev: who.rev })
    send(404, {})
  })
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${srv.address().port}`, hits })))
}
const doc = name => ({ unit: 'kg', routines: [{ id: 'r1', name, ex: [] }], _rev: 1 })

describe('remote profile', () => {
  test('a paired session reads the app routes, a scoped token its own, and only again when the revision moved', async () => {
    const docs = { 'sess.mac': { id: 'u1', doc: doc('A'), rev: 1 }, ['ogt_' + 'x'.repeat(43)]: { id: 'u2', doc: doc('B'), rev: 4 } }
    const { base, hits } = await stub(docs)
    const s = createRemoteProfile({ base, token: 'sess.mac' })
    await s.refresh()
    await s.refresh()
    expect(hits).toEqual(['GET /api/me', 'GET /api/data', 'GET /api/data/rev'])
    docs['sess.mac'].rev = 2
    docs['sess.mac'].doc = doc('A2')
    await s.refresh()
    expect(hits.slice(3)).toEqual(['GET /api/data/rev', 'GET /api/data'])
    expect(s.snapshot().state.routines[0].name).toBe('A2')
    expect(s.snapshot().scopes).toBe(null)

    hits.length = 0
    const t = createRemoteProfile({ base, token: 'ogt_' + 'x'.repeat(43) })
    await t.refresh()
    expect(hits).toEqual(['GET /api/token/me', 'GET /api/token/data'])
    expect(t.snapshot().scopes).toEqual({ plans: 'view' })
    t.invalidate()
    await t.refresh()
    expect(hits.at(-1)).toBe('GET /api/token/data')
  })

  test('the tools read the profile of the request in hand, concurrently', async () => {
    const one = { state: doc('Ana'), user: { id: 'a', name: 'Ana' } }
    const two = { state: doc('Bo'), user: { id: 'b', name: 'Bo' } }
    const slow = (p, ms) => withProfile(p, async () => { await new Promise(r => setTimeout(r, ms)); return [getUser().id, listRoutines.handler().routines[0].name] })
    expect(await Promise.all([slow(one, 30), slow(two, 5)])).toEqual([['a', 'Ana'], ['b', 'Bo']])
    expect(withProfile({ state: null, user: { id: 'c' } }, () => getState())).toBe(null)
  })
})

describe('which tools a scoped token sees', () => {
  test('every tool has a need, and the levels hold', () => {
    for (const t of ALL_TOOLS) expect(TOOL_NEEDS[t.name], t.name).toBeTruthy()
    expect(toolAllowed('list_workouts', null)).toBe(true)
    expect(toolAllowed('list_workouts', { workouts: 'view' })).toBe(true)
    expect(toolAllowed('log_workout', { workouts: 'view' })).toBe(false)
    expect(toolAllowed('log_workout', { workouts: 'apply' })).toBe(true)
    expect(toolAllowed('create_routine', { plans: 'view', workouts: 'apply' })).toBe(false)
    expect(toolAllowed('get_bodyweight', { bodyweight: 'view' })).toBe(true)
    expect(toolAllowed('some_new_tool', { workouts: 'apply', plans: 'apply' })).toBe(false)
    expect(toolAllowed('list_routines', {})).toBe(false)
  })
})
