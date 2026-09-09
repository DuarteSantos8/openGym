// The Coach on a phone with its own key: the same core the server runs, driven end to end
// here with a fake provider — payload → prompt → HTTP adapter → parser → validator → a proposal
// the apply engine accepts. Also the three things this mode has to get right on its own: the
// daily cap, the key never touching S, and a proposal surviving in the device file.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The device file and the secret store are in-memory here; nativeFetch is the script.
const device = { data: null }
vi.mock('./mobile.js', () => ({
  MOBILE: true,
  readJsonFile: async () => device.data,
  writeJsonFile: async (_n, d) => { device.data = JSON.parse(JSON.stringify(d)) }
}))
const secret = { key: 'sk-test-1' }
vi.mock('./coach-secrets.js', () => ({ getApiKey: async () => secret.key, setApiKey: async v => { secret.key = v }, clearApiKey: async () => { secret.key = null } }))
const wire = { calls: [], answer: null }
vi.mock('./capacitor-fetch.js', () => ({
  nativeFetch: async (url, init) => {
    wire.calls.push({ url, init, body: JSON.parse(init.body) })
    const a = typeof wire.answer === 'function' ? wire.answer(wire.calls.length) : wire.answer
    return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body), json: async () => a.body }
  }
}))

const local = await import('./coach-local.js')
const { _resetCoachDevice, loadCoachDevice, saveCoachDevice } = await import('./coach-device.js')
const { applyChangeSet, markStale, planHash } = await import('./coach.js')
const { EXERCISES } = await import('../../../api/coach/core/library-data.js')

const EX = EXERCISES[0].id, EX2 = EXERCISES[1].id
const state = () => ({
  unit: 'kg', lang: 'en',
  routines: [{ id: 'r1', name: 'A', ex: [{ id: EX, sets: 3, reps: 8, mode: 'reps' }, { id: EX2, sets: 3, reps: 10, mode: 'reps' }] }],
  week: { 1: 'r1' }, dayPlan: {}, customEx: [], bodyweight: [], workouts: [
    { d: '2026-08-20', start: 1, end: 3600001, entries: [{ id: EX, target: { sets: 3, reps: 8 }, sets: [{ done: true, w: 40, r: 8 }, { done: true, w: 40, r: 8 }, { done: true, w: 40, r: 8 }] }] }
  ],
  coach: { consent: { agreedAt: '2026-08-01T00:00:00Z', version: 1 }, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [] }
})
const chat = content => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content } }] } })
const review = { coach_contract: 1, summary: 'One tweak.', evidence: { from: '2026-08-01', to: '2026-08-20', sessions: 1 },
  changes: [{ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: EX }, after: 4, why: 'every set was clean' }] }

async function settle() {
  for (let i = 0; i < 200; i++) {
    const s = await local.localStatus()
    if (!s.job) return s
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('never settled')
}

describe('the Coach on a phone with its own key', () => {
  beforeEach(async () => {
    _resetCoachDevice(); local._resetLocal()
    device.data = { mode: 'byok', provider: 'openai', model: 'gpt-t', baseUrl: null }
    wire.calls = []; wire.answer = chat(JSON.stringify(review)); secret.key = 'sk-test-1'
  })

  it('runs a review through the real pipeline and produces a proposal the apply engine accepts', async () => {
    const S = state()
    await local.localReview(S, 'shoulder')
    const s = await settle()
    expect(s.pending).toBeTruthy()
    expect(s.pending.kind).toBe('review')
    expect(s.pending.planHash).toBe(planHash(S))
    expect(s.pending.changes).toHaveLength(1)
    expect(s.pending.changes[0].before).toBe(3)   // computed server-side… which is here
    // What went on the wire: OpenAI's shape, the key as a bearer, the payload in the user turn.
    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(wire.calls[0].init.headers.authorization).toBe('Bearer sk-test-1')
    expect(wire.calls[0].body.model).toBe('gpt-t')
    expect(wire.calls[0].body.messages[1].content).toContain('"userNote":"shoulder"')
    // …and the proposal applies with the ordinary engine.
    const marked = markStale(s.pending, S)
    expect(marked.changes[0].status).not.toBe('stale')
    applyChangeSet(S, marked, ['c1'])
    expect(S.routines[0].ex[0].sets).toBe(4)
    expect(S.coach.snapshots).toHaveLength(1)
  })

  it('spends the single repair round when the first answer is unusable, then gives up', async () => {
    wire.answer = n => n === 1 ? chat('{"coach_contract":1,"changes":[{"id":"x","type":"teleport"}]}') : chat(JSON.stringify(review))
    await local.localReview(state())
    const s = await settle()
    expect(wire.calls).toHaveLength(2)
    expect(wire.calls[1].body.messages[1].content).toContain('teleport')   // the errors went back verbatim
    expect(s.pending.changes).toHaveLength(1)

    local._resetLocal(); wire.calls = []
    await saveCoachDevice({ pending: null })
    wire.answer = chat('not json at all')
    await local.localReview(state())
    const f = await settle()
    expect(wire.calls).toHaveLength(2)
    expect(f.pending).toBeNull()
    expect(f.lastError.errorClass).toBe('unusable')
    expect(f.lastError.detail).toMatch(/JSON|object/i)   // the validator's reason reaches the phone — there is no admin card
  })

  it('a provider refusal carries the provider’s own words, so the person holding the key can act on it', async () => {
    // A 4xx the adapter does not retry (429 would wait out two retries first); the wording is OpenAI's.
    wire.answer = { status: 404, body: { error: { message: 'The model `gpt-4o-mini-tts` does not exist or you do not have access to it.' } } }
    const seen = []
    local.setNotifier(ev => seen.push(ev))
    await local.localReview(state())
    const s = await settle()
    expect(s.lastError.errorClass).toBe('provider')
    expect(s.lastError.detail).toMatch(/^404 The model `gpt-4o-mini-tts` does not exist/)
    expect(seen.at(-1)).toMatchObject({ kind: 'failed', errorClass: 'provider', detail: expect.stringMatching(/does not exist/) })
    local.setNotifier(null)
  })

  it('a 401 is an auth failure, and never a proposal', async () => {
    wire.answer = { status: 401, body: { error: { message: 'bad key' } } }
    await local.localReview(state())
    const s = await settle()
    expect(s.pending).toBeNull()
    expect(s.lastError.errorClass).toBe('auth')
  })

  it('the key never enters S, the device file, or the proposal', async () => {
    const S = state()
    await local.localReview(S)
    const s = await settle()
    expect(JSON.stringify(S)).not.toContain('sk-test-1')
    expect(JSON.stringify(device.data)).not.toContain('sk-test-1')
    expect(JSON.stringify(s.pending)).not.toContain('sk-test-1')
  })

  it('mints one 16-character pseudonym and keeps it; the payload carries it and never a name', async () => {
    await local.localReview({ ...state(), name: 'Duarte' })
    await settle()
    const first = (await loadCoachDevice()).handle
    expect(first).toHaveLength(16)
    const payload = wire.calls[0].body.messages[1].content
    expect(payload).toContain(`"profile":"${first}"`)
    expect(payload).not.toContain('Duarte')
    local._resetLocal(); await saveCoachDevice({ pending: null })
    await local.localReview(state()); await settle()
    expect((await loadCoachDevice()).handle).toBe(first)
  })

  it('refuses without consent, refuses while busy, and stops at the daily cap', async () => {
    const noConsent = state(); noConsent.coach.consent = null
    await expect(local.localReview(noConsent)).rejects.toMatchObject({ code: 'consent' })

    await local.localReview(state())
    await expect(local.localReview(state())).rejects.toMatchObject({ code: 'busy' })
    await settle()

    await saveCoachDevice({ daily: { d: new Date().toISOString().slice(0, 10), n: local.LOCAL_DAILY_CAP } })
    await expect(local.localReview(state())).rejects.toMatchObject({ code: 'cap' })
    expect((await local.localStatus()).cap).toEqual({ used: local.LOCAL_DAILY_CAP, limit: local.LOCAL_DAILY_CAP })
  })

  it('a proposal waits in the device file, expires, and is cleared by resolve', async () => {
    await local.localReview(state())
    await settle()
    expect(device.data.pending).toBeTruthy()
    await saveCoachDevice({ pending: { ...device.data.pending, expiresAt: Date.now() - 1 } })
    expect((await local.localStatus()).pending).toBeNull()
    await local.localReview(state()); await settle()
    await local.localResolve()
    expect(device.data.pending).toBeNull()
  })

  it('creates a plan from an intake, and refines it against the previous bundle', async () => {
    const plan = { coach_contract: 1, opengym_plan: 1, name: 'P', summary: 's', basedOn: 'b', week: { 1: 'r1', 3: 'r2', 5: 'r1' },
      routines: [
        { id: 'r1', name: 'A', emoji: '💪', why: 'w', ex: [{ id: EX, sets: 3, mode: 'reps', reps: 8, why: 'w' }, { id: EX2, sets: 3, mode: 'reps', reps: 10, why: 'w' }, { id: EXERCISES[2].id, sets: 3, mode: 'reps', reps: 10, why: 'w' }] },
        { id: 'r2', name: 'B', emoji: '🏋️', why: 'w', ex: [{ id: EXERCISES[3].id, sets: 3, mode: 'reps', reps: 8, why: 'w' }, { id: EXERCISES[4].id, sets: 3, mode: 'reps', reps: 10, why: 'w' }, { id: EXERCISES[5].id, sets: 3, mode: 'reps', reps: 10, why: 'w' }] }
      ], customEx: [] }
    wire.answer = chat(JSON.stringify(plan))
    const S = { ...state(), routines: [], week: {} }
    await local.localPlan(S, { goal: 'muscle', daysPerWeek: 3 })
    const s = await settle()
    expect(s.pending.kind).toBe('create')
    expect(s.pending.bundle.routines).toHaveLength(2)
    expect(wire.calls[0].body.messages[1].content).toContain('"daysPerWeek":3')

    await local.localRefine(S, 'no lunges')
    const r = await settle()
    expect(r.pending.iteration).toBe(2)
    expect(wire.calls[1].body.messages[1].content).toContain('no lunges')
    expect(wire.calls[1].body.messages[1].content).toContain('"previous"')
  })

  it('disclosure says who pays and where it goes', async () => {
    const d = await local.localDisclosure()
    expect(d.payer).toBe('you')
    expect(d.host).toBe('api.openai.com')
    expect(d.categories).toEqual(['plan', 'training', 'bodyweight', 'profile', 'prefs'])
  })
})

describe('timeouts on the phone', () => {
  it('gives a local endpoint the long budget and cloud providers the short one', async () => {
    const { timeoutFor, TIMEOUT_MS, LOCAL_ENDPOINT_TIMEOUT_MS } = await import('./coach-local.js')
    expect(timeoutFor('compatible')).toBe(LOCAL_ENDPOINT_TIMEOUT_MS)
    expect(LOCAL_ENDPOINT_TIMEOUT_MS).toBeGreaterThanOrEqual(20 * 60000)
    for (const p of ['anthropic', 'openai', 'gemini']) expect(timeoutFor(p)).toBe(TIMEOUT_MS)
  })
  it('the native transport read timeout outlasts the longest job', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./capacitor-fetch.js', import.meta.url), 'utf8')
    const m = src.match(/readTimeout:\s*(\d+)\s*\*\s*60000/)
    expect(m).toBeTruthy()
    expect(+m[1] * 60000).toBeGreaterThan(25 * 60000)
  })
})
