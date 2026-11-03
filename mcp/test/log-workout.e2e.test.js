// log_workout against the real api/server.js in a child process, on a temp data directory: what
// the server stores when the MCP writes, read back off disk and through the server's own routes.
// Needs api/'s dependencies (`npm ci` in api/). Without them it skips on a laptop and fails in CI,
// so a green run there always means it ran.
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api')
const HAVE_API = fs.existsSync(path.join(API, 'node_modules', '@simplewebauthn', 'server'))
if (!HAVE_API && process.env.CI) throw new Error('api/node_modules is missing: run `npm ci` in api/ before the MCP tests in CI')

const SECRET = crypto.randomBytes(32).toString('hex')
const UID = 'u_mcp_1'
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}
const TOKEN = mint(UID)
const at = (d, hh) => new Date(`${d}T${hh}:00`).getTime()
// A document the way a device leaves it: settings, a routine, a workout, the records of edits.
const DOC = {
  unit: 'kg', restSec: 120, effort: 'rir', targetW: 80,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100, mode: 'reps' }], _ts: 1000 }],
  week: { 1: ['r1'] },
  workouts: [{ id: 'w-old', d: '2026-10-13', start: at('2026-10-13', '18:00'), end: at('2026-10-13', '19:00'), routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [], entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], topW: 100, target: null }] }],
  exWeights: { '0025': { w: 100, d: '2026-10-13' } },
  customEx: [], bodyweight: [{ d: '2026-10-13', w: 80, t: 1000 }],
  deleted: {}, edited: { restSec: 900, effort: 900 },
  _rev: 5, _wid: 'w-seed', _ts: 1000,
}

let child, dataDir, base, log = ''
const get = async p => (await fetch(base + p, { headers: { authorization: 'Bearer ' + TOKEN } })).json()
const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'))

describe.skipIf(!HAVE_API)('log_workout against the real api', () => {
  let logWorkout, getState, TOOLS
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-e2e-'))
    fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 })
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'Matt', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }))
    fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify(DOC))
    child = spawn(process.execPath, ['server.js'], {
      cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
    })
    child.stderr.on('data', d => { log += d })
    // The boot line names the port the child bound (api/test/helpers.mjs boundPort): address and
    // readiness signal at once.
    const port = await new Promise((resolve, reject) => {
      const give = setTimeout(() => reject(new Error('server never announced a port:\n' + log)), 20000)
      child.stdout.on('data', d => {
        log += d
        const m = /gym-api on :(\d+)/.exec(log)
        if (m) { clearTimeout(give); resolve(+m[1]) }
      })
      child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${log}`)) })
    })
    base = `http://127.0.0.1:${port}`
    // The read tools read the same directory the server writes, as on a real install.
    process.env.OPENGYM_DATA = dataDir
    process.env.OPENGYM_UID = UID
    ;({ logWorkout } = await import('../src/write-tools.js'))
    ;({ getState } = await import('../src/state.js'))
    ;({ TOOLS } = await import('../src/tools.js'))
  }, 30000)
  afterAll(() => {
    child?.kill('SIGKILL')
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  const env = () => ({ OPENGYM_URL: base, OPENGYM_TOKEN: TOKEN })
  const CURLS = { exercises: [{ exercise: 'dumbbell curl', sets: [{ reps: 12, weight: 12 }, { reps: 12, weight: 12 }, { reps: 10, weight: 12 }] }] }

  test('stored: the device document as it was, plus one workout, one revision on', async () => {
    // read the revision first, so the stat cache holds rev 5 when the write lands
    expect((await get('/api/data/rev')).rev).toBe(5)
    const r = await logWorkout.handler(CURLS, { env: env() })
    expect(r.logged).toBe(true)

    const after = stored()
    expect(after._rev).toBe(6)                       // +1: the server found nothing to restamp
    expect((await get('/api/data/rev')).rev).toBe(6) // and the cached revision moved with it
    expect(after._wids).toContain('w-seed')
    expect(after.workouts.map(w => w.id)).toEqual(['w-old', r.workout_id])
    expect(after.edited).toEqual(DOC.edited)
    for (const k of ['unit', 'restSec', 'effort', 'targetW', 'routines', 'week', 'bodyweight', 'customEx']) expect(after[k]).toEqual(DOC[k])
    expect(after.deleted ?? {}).toEqual({})          // no removal on record (an empty map is not kept)
    // the server added only its own bookkeeping, and nothing a device would read as a setting
    const extra = Object.keys(after).filter(k => !(k in DOC))
    expect(extra.filter(k => !k.startsWith('_'))).toEqual([])
    const w = after.workouts[1]
    expect(w.entries[0]).toMatchObject({ id: '0294', sets: [{ w: 12, r: 12, done: true }, { w: 12, r: 12, done: true }, { w: 12, r: 10, done: true }] })
  })

  test('read back by the read tools, from the same directory, straight away', async () => {
    const S = getState()
    expect(S.workouts).toHaveLength(2)
    const list = TOOLS.find(t => t.name === 'list_workouts').handler({ limit: 5 })
    expect(JSON.stringify(list)).toContain('Workout')
  })

  test('the same call again stores nothing', async () => {
    const r = await logWorkout.handler(CURLS, { env: env() })
    expect(r).toMatchObject({ logged: false, duplicate: true })
    expect(stored()._rev).toBe(6)
  })

  test('a backup restored in between (same revision, another write id) is merged, not written over', async () => {
    let restored = false
    const fetchImpl = async (url, opts) => {
      if (opts?.method === 'PUT' && !restored) {
        restored = true
        // the operator puts back a copy whose counter happens to match: only the write id differs
        const cur = stored()
        fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({ ...cur, targetW: 77, _wid: 'w-restored' }))
      }
      return fetch(url, opts)
    }
    const r = await logWorkout.handler({ date: '2026-10-12', exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 95 }] }] }, { env: env(), fetchImpl })
    expect(r.logged).toBe(true)
    const after = stored()
    expect(after.targetW).toBe(77)
    expect(after._wids).toContain('w-restored')
    expect(after.workouts.some(w => w.d === '2026-10-12')).toBe(true)
  })

  test('a phone pushing in between: both its change and the workout survive', async () => {
    const phonePush = async () => {
      const cur = await get('/api/data')
      const next = { ...cur.state, restSec: 75 }
      const res = await fetch(base + '/api/data', {
        method: 'PUT', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ state: next, baseRev: cur.rev, baseWid: cur.state._wid }),
      })
      expect(res.status).toBe(200)
    }
    let pushed = false
    // the phone's write lands after the MCP read the document and before it writes
    const fetchImpl = async (url, opts) => {
      if (opts?.method === 'PUT' && !pushed) { pushed = true; await phonePush() }
      return fetch(url, opts)
    }
    const r = await logWorkout.handler({ date: '2026-10-14', exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 102.5 }] }] }, { env: env(), fetchImpl })
    expect(r.logged).toBe(true)
    const after = stored()
    expect(after.restSec).toBe(75)
    const days = after.workouts.map(w => w.d)
    expect(days).toContain('2026-10-14')
    expect(days).toEqual([...days].sort())
    // into the past: a backfill, so the confirmed weight stays where the device left it
    expect(after.exWeights['0025']).toEqual(DOC.exWeights['0025'])
  })
})
