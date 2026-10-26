// Automatic reviews on a phone with its own key (Discord, 10-19: "I enabled it a week ago and
// haven't gotten anything"). The server runs them on its tick; this phone has no server, and
// nothing ran them at all. Driven here like coach-local.test.js: the real pipeline, a fake
// provider, the device file in memory.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const device = { data: null }
vi.mock('./mobile.js', () => ({
  MOBILE: true,
  readJsonFile: async () => device.data,
  writeJsonFile: async (_n, d) => { device.data = JSON.parse(JSON.stringify(d)) }
}))
vi.mock('./coach-secrets.js', () => ({ getApiKey: async () => 'sk-test-1' }))
const wire = { calls: [], answer: null }
vi.mock('./capacitor-fetch.js', () => ({
  nativeFetch: async (url, init) => {
    wire.calls.push({ url, body: JSON.parse(init.body) })
    const a = wire.answer
    return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body), json: async () => a.body }
  }
}))

const local = await import('./coach-local.js')
const { _resetCoachDevice, loadCoachDevice } = await import('./coach-device.js')
const { EXERCISES } = await import('../../../api/coach/core/library-data.js')
const { todayISO } = await import('./format.js')

const EX = EXERCISES[0].id
const chat = content => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content } }] } })
const REVIEW = { coach_contract: 1, summary: 'One tweak.', evidence: { from: '2026-10-01', to: '2026-10-15', sessions: 1 },
  changes: [{ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: EX }, after: 4, why: 'every set was clean' }] }
const NOCHANGE = { coach_contract: 1, nochange: true, reading: 'Too early to judge.' }

const at = (d, h = 18, m = 0) => new Date(2026, 9, d, h, m)         // October 2026, the phone's own clock
const workout = (id, end) => ({ id, d: '2026-10-' + String(end.getDate()).padStart(2, '0'), start: end.getTime() - 3600000, end: end.getTime(),
  entries: [{ id: EX, target: { sets: 3, reps: 8 }, sets: [{ done: true, w: 40, r: 8 }, { done: true, w: 40, r: 8 }, { done: true, w: 40, r: 8 }] }] })
const state = (cadence, workouts, lastReview = null) => ({
  unit: 'kg', lang: 'en',
  routines: [{ id: 'r1', name: 'A', ex: [{ id: EX, sets: 3, reps: 8, mode: 'reps' }] }],
  week: { 1: 'r1' }, dayPlan: {}, customEx: [], bodyweight: [], workouts,
  coach: { consent: { agreedAt: '2026-08-01T00:00:00Z', version: 1 }, profile: null, cadence, lastReview, log: [], snapshots: [] }
})

async function settle() {
  for (let i = 0; i < 200; i++) {
    const s = await local.localStatus()
    if (!s.job) return s
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('never settled')
}

describe('automatic reviews on a phone with its own key', () => {
  const seen = []
  beforeEach(() => {
    _resetCoachDevice(); local._resetLocal()
    device.data = { mode: 'byok', provider: 'compatible', model: 'llama', baseUrl: 'https://llm.home.example/v1' }
    wire.calls = []; wire.answer = chat(JSON.stringify(REVIEW))
    seen.length = 0; local.setNotifier(ev => seen.push(ev))
  })

  it('after every few workouts: runs once the count is met, and once per batch', async () => {
    const S = state({ everyWorkouts: 2 }, [workout('w1', at(12))])
    expect(await local.localScheduled(S, at(12, 19))).toBeNull()
    expect(wire.calls).toHaveLength(0)

    S.workouts.push(workout('w2', at(14)))
    const started = await local.localScheduled(S, at(14, 19))
    expect(started?.job?.trigger).toBe('scheduled')
    const s = await settle()
    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0].url).toBe('https://llm.home.example/v1/chat/completions')
    expect(s.pending.kind).toBe('review')
    expect(seen.at(-1)).toMatchObject({ kind: 'ready', scheduled: true })

    // A proposal nobody has answered is not replaced, however many workouts follow.
    S.workouts.push(workout('w3', at(15)), workout('w4', at(16)))
    expect(await local.localScheduled(S, at(16, 19))).toBeNull()

    // Answered: the two workouts it read are not read again; two new ones are a new batch.
    await local.localResolve()
    const reviewedAt = (await loadCoachDevice()).reviewedAt
    expect(reviewedAt).toBeGreaterThan(0)
    S.workouts = S.workouts.map(w => ({ ...w, end: Math.min(w.end, reviewedAt - 1) }))
    expect(await local.localScheduled(S, new Date(reviewedAt + 60000))).toBeNull()
    S.workouts.push(workout('w5', new Date(reviewedAt + 3600000)), workout('w6', new Date(reviewedAt + 7200000)))
    expect(await local.localScheduled(S, new Date(reviewedAt + 7300000))).toBeTruthy()
    await settle()
    expect(wire.calls).toHaveLength(2)
  })

  it('weekly: not before the slot, on the first look after it, and not again that week', async () => {
    wire.answer = chat(JSON.stringify(NOCHANGE))
    // Sunday 18:00. The last review was the Sunday before; a workout since.
    const S = state({ weekly: { day: 0, time: '18:00' } }, [workout('w1', at(14))], { at: at(11, 18, 5).getTime() })
    expect(await local.localScheduled(S, at(18, 17, 30))).toBeNull()
    expect(await local.localScheduled(S, at(18, 18, 0))).toBeTruthy()
    await settle()
    expect(wire.calls).toHaveLength(1)
    // "Nothing to change" counts as this week's review, and says nothing about it.
    expect(seen.at(-1)).toMatchObject({ kind: 'nochange', scheduled: true })
    S.workouts.push(workout('w2', new Date(Date.now() + 60000)))
    expect(await local.localScheduled(S, at(18, 21, 0))).toBeNull()
    expect(wire.calls).toHaveLength(1)
  })

  it('a phone the slot passed while closed runs it on the next open', async () => {
    wire.answer = chat(JSON.stringify(NOCHANGE))
    const S = state({ weekly: { day: 0, time: '18:00' } }, [workout('w1', at(14))], { at: at(11, 18, 5).getTime() })
    expect(await local.localScheduled(S, at(20, 7, 45))).toBeTruthy()   // Tuesday morning
    await settle()
    expect(wire.calls).toHaveLength(1)
  })

  it('respects the daily runs dial from Advanced, where 0 is no limit (#527)', async () => {
    const two = [workout('w1', at(12)), workout('w2', at(13))]
    device.data = { ...device.data, daily: { d: todayISO(), n: 10 } }
    expect(await local.localScheduled(state({ everyWorkouts: 1 }, two), at(14))).toBeNull()
    device.data = { ...device.data, limits: { daily: 0 } }; _resetCoachDevice()
    expect(await local.localScheduled(state({ everyWorkouts: 1 }, two), at(14))).toBeTruthy()
    await settle()
    expect(wire.calls).toHaveLength(1)
  })

  it('stays out of the way: off, no consent, another mode, a job running', async () => {
    const two = [workout('w1', at(12)), workout('w2', at(13))]
    expect(await local.localScheduled(state('off', two), at(14))).toBeNull()
    const noConsent = state({ everyWorkouts: 1 }, two); noConsent.coach.consent = null
    expect(await local.localScheduled(noConsent, at(14))).toBeNull()
    device.data = { ...device.data, mode: 'server' }; _resetCoachDevice()
    expect(await local.localScheduled(state({ everyWorkouts: 1 }, two), at(14))).toBeNull()
    expect(wire.calls).toHaveLength(0)

    device.data = { ...device.data, mode: 'byok' }; _resetCoachDevice()
    await local.localReview(state('off', two))
    expect(await local.localScheduled(state({ everyWorkouts: 1 }, two), at(14))).toBeNull()
    await settle()
    expect(wire.calls).toHaveLength(1)
  })
})
